/**
 * Tren kehadiran harian SATU SEKOLAH (semua kelas) untuk grafik beranda admin sekolah, bulan fixture
 * Mei 2091 (Sen-Jum): baris beberapa kelas + tanpa kelas dijumlahkan per hari, hari libur bercatatan
 * isSchoolDay=false, hari sekolah tanpa data -> null, pemotongan closedThrough, rentang default 30
 * hari, rentang > 92 hari -> 400, dan aturan cakupan (admin sekolah lain, super admin wajib schoolId).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as schoolTrendRoute } from "@/app/api/v1/school/attendance/analytics/trend/route";
import { getClassTrend, getSchoolTrend } from "@/lib/attendance/analytics-queries";
import { toDbDate } from "@/lib/time/zone";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { callRoute, type Envelope } from "../../helpers/request";
import {
  addRows,
  adminCtx,
  createMonitorSchool,
  createNamedClass,
  createNamedStudent,
  createSuperToken,
  withSchool,
  type MonitorSchool,
  type RowInput,
} from "./fixtures";

const CLOSED_NOW = new Date("2091-05-20T10:00:00Z"); // 17:00 WIB (setelah dayEnd 15:00)
const MID_NOW = new Date("2091-05-08T05:00:00Z"); // 12:00 WIB (sebelum dayEnd) -> closedThrough kemarin
const URL = "/api/v1/school/attendance/analytics/trend";

let tenant: MonitorSchool;
let other: MonitorSchool;
let classA = "";
let classB = "";
let superToken = "";
let studentToken = "";

before(async () => {
  tenant = await createMonitorSchool();
  other = await createMonitorSchool();
  superToken = await createSuperToken();
  classA = await createNamedClass(tenant, "VIII-A");
  classB = await createNamedClass(tenant, "VIII-B");
  const [a1, a2] = await Promise.all(["A1", "A2"].map((n) => createNamedStudent(tenant.school.id, `Siswa ${n}`, { classId: classA })));
  const [b1, b2] = await Promise.all(["B1", "B2"].map((n) => createNamedStudent(tenant.school.id, `Siswa ${n}`, { classId: classB })));
  const loose = await createNamedStudent(tenant.school.id, "Siswa Tanpa Kelas");
  const foreign = await createNamedStudent(other.school.id, "Siswa Lain");
  studentToken = (await createSessionToken(a1!.userId)).token;
  const s = tenant.school.id;
  const row = (studentId: string, classId: string | null, date: string, status: RowInput["status"]): RowInput => ({ schoolId: s, studentId, classId, date, status });
  await addRows([
    // Senin 07: kelas A (HADIR, TERLAMBAT) + kelas B (HADIR, ALPHA) -> 4 tercatat, hadir 3.
    row(a1!.id, classA, "2091-05-07", "HADIR"), row(a2!.id, classA, "2091-05-07", "TERLAMBAT"),
    row(b1!.id, classB, "2091-05-07", "HADIR"), row(b2!.id, classB, "2091-05-07", "ALPHA"),
    // Selasa 08: A IZIN, B HADIR, tanpa kelas SAKIT -> 3 tercatat, hadir 1.
    row(a1!.id, classA, "2091-05-08", "IZIN"), row(b1!.id, classB, "2091-05-08", "HADIR"), row(loose.id, null, "2091-05-08", "SAKIT"),
    // Rabu 09 libur sekolah tetapi bercatatan -> isSchoolDay=false. Kamis 10 tanpa data. Jumat 11: B HADIR.
    row(a1!.id, classA, "2091-05-09", "HADIR"),
    row(b2!.id, classB, "2091-05-11", "HADIR"),
    // Sekolah lain di tanggal yang sama tidak ikut terhitung.
    { schoolId: other.school.id, studentId: foreign.id, classId: null, date: "2091-05-07", status: "ALPHA" },
  ]);
  await prisma.holiday.createMany({
    data: [
      { schoolId: s, name: "Libur Tren Sekolah", startDate: toDbDate("2091-05-09"), endDate: toDbDate("2091-05-09") },
      { schoolId: s, name: "Libur Tren Kosong", startDate: toDbDate("2091-05-14"), endDate: toDbDate("2091-05-14") },
    ],
  });
});
after(disconnect);

test("tren sekolah menjumlahkan semua kelas (+ tanpa kelas) per hari; libur bercatatan isSchoolDay=false", async () => {
  const trend = await getSchoolTrend(adminCtx(tenant, CLOSED_NOW), { from: "2091-05-07", to: "2091-05-14" });
  assert.deepEqual(Object.keys(trend), ["from", "to", "closedThrough", "days"]);
  assert.deepEqual([trend.from, trend.to, trend.closedThrough], ["2091-05-07", "2091-05-14", "2091-05-20"]);
  assert.deepEqual(trend.days.map((d) => [d.date, d.isSchoolDay, d.recorded, d.presentPct, d.latePct, d.alphaPct]), [
    ["2091-05-07", true, 4, 75, 25, 25],
    ["2091-05-08", true, 3, 33.3, 0, 0],
    ["2091-05-09", false, 1, 100, 0, 0],
    ["2091-05-10", true, 0, null, null, null],
    ["2091-05-11", true, 1, 100, 0, 0],
  ]);
  assert.deepEqual(trend.days[1]?.counts, { hadir: 1, terlambat: 0, izin: 1, sakit: 1, alpha: 0 });
  const range = { from: "2091-05-07", to: "2091-05-07" };
  const [a, b] = await Promise.all([classA, classB].map((id) => getClassTrend(adminCtx(tenant, CLOSED_NOW), id, range)));
  assert.equal((a?.days[0]?.recorded ?? 0) + (b?.days[0]?.recorded ?? 0), trend.days[0]?.recorded, "jumlah per kelas = total sekolah");
});

test("tren sekolah: rentang default 30 hari terakhir & dipotong di closedThrough", async () => {
  const trend = await getSchoolTrend(adminCtx(tenant, CLOSED_NOW), {});
  assert.deepEqual([trend.from, trend.to], ["2091-04-21", "2091-05-20"]);
  assert.deepEqual(trend.days.filter((d) => d.recorded > 0).map((d) => d.date), ["2091-05-07", "2091-05-08", "2091-05-09", "2091-05-11"]);
  assert.ok(trend.days.every((d) => d.date >= trend.from && d.date <= trend.closedThrough));
  const cut = await getSchoolTrend(adminCtx(tenant, MID_NOW), { from: "2091-05-07", to: "2091-05-11" });
  assert.equal(cut.closedThrough, "2091-05-07");
  assert.deepEqual(cut.days.map((d) => [d.date, d.recorded]), [["2091-05-07", 4]]);
  const future = await getSchoolTrend(adminCtx(tenant, MID_NOW), { from: "2091-05-08", to: "2091-05-11" });
  assert.deepEqual(future.days, []);
});

test("tren sekolah terisolasi per tenant: admin sekolah lain hanya melihat sekolahnya", async () => {
  const trend = await getSchoolTrend(adminCtx(other, CLOSED_NOW), { from: "2091-05-07", to: "2091-05-08" });
  assert.deepEqual(trend.days.map((d) => [d.date, d.recorded, d.alphaPct]), [
    ["2091-05-07", 1, 100],
    ["2091-05-08", 0, null],
  ]);
});

test("route tren sekolah: 200 sesuai kontrak, 400 rentang tidak valid (> 92 hari / from > to)", async () => {
  const ok = await callRoute<Envelope<{ from: string; to: string; days: unknown[] }>>(schoolTrendRoute, { method: "GET", url: URL, bearer: tenant.adminToken });
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
  assert.ok(Array.isArray(ok.body?.data.days));
  const bad = ["?from=2091-01-01&to=2091-04-03", "?from=2091-05-11&to=2091-05-07", "?from=2020-01-01", "?to=2091-13-01"];
  for (const qs of bad) {
    const res = await callRoute(schoolTrendRoute, { method: "GET", url: `${URL}${qs}`, bearer: tenant.adminToken });
    assert.equal(res.status, 400, qs);
  }
});

test("route tren sekolah: cakupan peran (401/403/400/404) & super admin dengan schoolId -> 200", async () => {
  const cases: ReadonlyArray<[string | undefined, string | undefined, number, string | null]> = [
    [undefined, undefined, 401, "UNAUTHENTICATED"],
    [studentToken, undefined, 403, "FORBIDDEN"],
    [tenant.adminToken, other.school.id, 403, "SCOPE_MISMATCH"],
    [superToken, undefined, 400, "SCHOOL_ID_REQUIRED"],
    [superToken, "sekolah-tidak-ada", 404, "SCHOOL_NOT_FOUND"],
    [superToken, tenant.school.id, 200, null],
    [tenant.adminToken, tenant.school.id, 200, null],
  ];
  for (const [token, schoolId, status, code] of cases) {
    const res = await callRoute(schoolTrendRoute, { method: "GET", url: withSchool(`${URL}?from=2091-05-07&to=2091-05-11`, schoolId), bearer: token });
    assert.equal(res.status, status, `${status}: ${JSON.stringify(res.body?.error)}`);
    if (code) assert.equal(res.body?.error?.code, code);
  }
});
