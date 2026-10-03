/**
 * Alasan terlambat di sisi admin (A1): ikut di Data Absensi, Peta, dan detail catatan; hitungan per
 * kategori GET /school/attendance/late-reasons (rentang, kelas, baris dikoreksi, tenancy, validasi).
 * Tanggal fixture 2091-03 (WIB, Sen-Jum).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as detailRoute } from "@/app/api/v1/school/attendance/[id]/route";
import { GET as dailyRoute } from "@/app/api/v1/school/attendance/daily/route";
import { GET as lateReasonsRoute } from "@/app/api/v1/school/attendance/late-reasons/route";
import { GET as mapRoute } from "@/app/api/v1/school/attendance/map/route";
import { getLateReasonCounts } from "@/lib/attendance/late-reason-queries";
import { instantAtLocal, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { createStoredFile } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { adminCtx, createMonitorSchool, createNamedClass, createNamedStudent, createSuperToken, rowData, withSchool, type MonitorSchool } from "./fixtures";

const D = "2091-03-12"; // Senin
const D_PREV_MONTH = "2091-02-26";

let tenant: MonitorSchool;
let other: MonitorSchool;
let classA = "";
let classB = "";
let foreignClass = "";
let superToken = "";
let reasonedId = "";

interface Counts {
  from: string;
  to: string;
  total: number;
  filled: number;
  unfilled: number;
  categories: { category: string; count: number }[];
}

type Reason = { category: "TRANSPORT" | "WEATHER" | "FAMILY" | "OTHER"; note?: string } | null;

/** Baris check-in (default) atau catatan admin, dengan/atau tanpa alasan terlambat. */
async function lateRow(studentId: string, classId: string, date: string, reason: Reason, options: { status?: "TERLAMBAT" | "HADIR"; source?: "CHECKIN" | "ADMIN" } = {}) {
  const status = options.status ?? "TERLAMBAT";
  const base = rowData({ schoolId: tenant.school.id, studentId, classId, date, status, checkInAt: instantAtLocal(date, 440, "WIB"), latitude: "-6.9147000", longitude: "107.6098000", accuracyM: 10, distanceM: 15 });
  const checkIn = (options.source ?? "CHECKIN") === "CHECKIN";
  const selfie = checkIn ? await createStoredFile(tenant.adminId, "ATTENDANCE_SELFIE", { schoolId: tenant.school.id }) : null;
  const row = await prisma.attendance.create({
    data: {
      ...base,
      source: checkIn ? "CHECKIN" : "ADMIN",
      selfieFileId: selfie?.id ?? null,
      lateReasonCategory: reason?.category ?? null,
      lateReasonNote: reason?.note ?? null,
      lateReasonAt: reason ? instantAtLocal(date, 445, "WIB") : null,
    },
  });
  return row.id;
}

before(async () => {
  tenant = await createMonitorSchool();
  other = await createMonitorSchool();
  superToken = await createSuperToken();
  classA = await createNamedClass(tenant, "IX-A");
  classB = await createNamedClass(tenant, "IX-B");
  foreignClass = await createNamedClass(other, "IX-Z");
  const names = ["Ani", "Budi", "Citra", "Dedi", "Eka", "Fajar", "Gita", "Hana"];
  const students = await Promise.all(names.map((name, i) => createNamedStudent(tenant.school.id, name, { classId: i < 4 || i > 5 ? classA : classB })));
  const [ani, budi, citra, dedi, eka, fajar, gita, hana] = students.map((s) => s.id) as [string, string, string, string, string, string, string, string];
  reasonedId = await lateRow(ani, classA, D, { category: "OTHER", note: "Ban sepeda bocor" });
  await lateRow(budi, classA, D, { category: "WEATHER" });
  await lateRow(citra, classA, D, null); // belum diisi
  await lateRow(dedi, classA, D, { category: "TRANSPORT" }, { status: "HADIR", source: "ADMIN" }); // dikoreksi menjadi HADIR: tidak dihitung
  await lateRow(eka, classB, D, { category: "WEATHER" });
  await lateRow(fajar, classB, D_PREV_MONTH, { category: "TRANSPORT" });
  await lateRow(gita, classA, D, null, { source: "ADMIN" }); // dicatat admin tanpa alasan: siswa tak bisa mengisi -> tidak dihitung
  await lateRow(hana, classA, D, { category: "FAMILY" }, { source: "ADMIN" }); // dikoreksi tetap TERLAMBAT: alasan tetap dihitung
});
after(disconnect);

const NOW = instantAtLocal(D, 600, "WIB");

test("hitungan default: awal bulan s.d. hari ini, kategori nol diisi; koreksi HADIR & catatan admin tanpa alasan tidak dihitung", async () => {
  const counts = await getLateReasonCounts(adminCtx(tenant, NOW), {});
  assert.equal(counts.from, "2091-03-01");
  assert.equal(counts.to, D);
  assert.deepEqual([counts.total, counts.filled, counts.unfilled], [5, 4, 1]);
  assert.deepEqual(counts.categories, [
    { category: "TRANSPORT", count: 0 }, { category: "WEATHER", count: 2 }, { category: "OVERSLEPT", count: 0 },
    { category: "FAMILY", count: 1 }, { category: "HEALTH", count: 0 }, { category: "OTHER", count: 1 },
  ]);
});

test("filter rentang & kelas", async () => {
  const wide = await getLateReasonCounts(adminCtx(tenant, NOW), { from: "2091-02-20", to: D });
  assert.equal(wide.total, 6);
  assert.equal(wide.categories.find((c) => c.category === "TRANSPORT")?.count, 1);
  const onlyB = await getLateReasonCounts(adminCtx(tenant, NOW), { classId: classB });
  assert.deepEqual([onlyB.total, onlyB.filled], [1, 1]);
  const prevMonth = await getLateReasonCounts(adminCtx(tenant, NOW), { to: "2091-02-28" });
  assert.deepEqual([prevMonth.from, prevMonth.total], ["2091-02-01", 1]);
});

test("route: kelas sekolah lain 404, super admin tanpa schoolId 400, rentang > 92 hari 400, super admin dengan schoolId 200", async () => {
  const get = (url: string, token = tenant.adminToken) => callRoute<Envelope<Counts>>(lateReasonsRoute, { method: "GET", url, bearer: token });
  const foreign = await get(`/api/v1/school/attendance/late-reasons?classId=${foreignClass}`);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body?.error?.code, "CLASS_NOT_FOUND");
  const noSchool = await get("/api/v1/school/attendance/late-reasons", superToken);
  assert.equal(noSchool.status, 400);
  assert.equal(noSchool.body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await get("/api/v1/school/attendance/late-reasons?from=2090-11-01&to=2091-03-12")).status, 400);
  const ok = await get(withSchool(`/api/v1/school/attendance/late-reasons?from=2091-03-01&to=${D}`, tenant.school.id), superToken);
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
  assert.equal(ok.body?.data.total, 5);
  const stranger = await get(withSchool(`/api/v1/school/attendance/late-reasons?from=2091-03-01&to=${D}`, tenant.school.id), other.adminToken);
  assert.equal(stranger.status, 403);
});

test("Data Absensi, Peta, dan detail membawa alasan terlambat", async () => {
  const daily = await callRoute<Envelope<{ attendance: { id: string; lateReason: { category: string; note: string | null } | null } | null }[]>>(dailyRoute, {
    method: "GET", url: `/api/v1/school/attendance/daily?date=${D}&classId=${classA}`, bearer: tenant.adminToken,
  });
  assert.equal(daily.status, 200, JSON.stringify(daily.body?.error));
  const own = daily.body?.data.find((r) => r.attendance?.id === reasonedId);
  assert.deepEqual(own?.attendance?.lateReason, { category: "OTHER", note: "Ban sepeda bocor", timeLocal: "07:25", updatedAt: instantAtLocal(D, 445, "WIB").toISOString() });

  const map = await callRoute<Envelope<{ points: { attendanceId: string; lateReasonCategory: string | null }[] }>>(mapRoute, {
    method: "GET", url: `/api/v1/school/attendance/map?date=${D}`, bearer: tenant.adminToken,
  });
  assert.equal(map.status, 200, JSON.stringify(map.body?.error));
  assert.equal(map.body?.data.points.find((p) => p.attendanceId === reasonedId)?.lateReasonCategory, "OTHER");

  const detail = await callRoute<Envelope<{ lateReason: { category: string } | null }>>(detailRoute, {
    method: "GET", url: `/api/v1/school/attendance/${reasonedId}`, bearer: tenant.adminToken, params: { id: reasonedId },
  });
  assert.equal(detail.status, 200, JSON.stringify(detail.body?.error));
  assert.equal(detail.body?.data.lateReason?.category, "OTHER");
  assert.ok(await prisma.attendance.count({ where: { schoolId: tenant.school.id, date: toDbDate(D) } }) >= 5);
});
