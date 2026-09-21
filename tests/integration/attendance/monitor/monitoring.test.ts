/**
 * Monitoring harian admin pada tanggal fixture (Senin 2091-03-12, WIB): kartu hari ini, Data Absensi
 * (filter status/BELUM_ABSEN/anomali/kelas/q + paging), Peta (titik, unlocated, truncated, penolakan),
 * Rekap Kelas, detail catatan (selfie, flag berlabel, penolakan hari itu, audit), anomali, penolakan.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as detailRoute } from "@/app/api/v1/school/attendance/[id]/route";
import { GET as anomaliesRoute } from "@/app/api/v1/school/attendance/anomalies/route";
import { GET as dailyRoute } from "@/app/api/v1/school/attendance/daily/route";
import { GET as mapRoute } from "@/app/api/v1/school/attendance/map/route";
import { GET as recapRoute } from "@/app/api/v1/school/attendance/recap/route";
import { GET as rejectionsRoute } from "@/app/api/v1/school/attendance/rejections/route";
import { getMap, getTodayStats } from "@/lib/attendance/monitoring-queries";
import { instantAtLocal, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { createStoredFile } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { addRows, adminCtx, createMonitorSchool, createNamedClass, createNamedStudent, createSuperToken, withSchool, type MonitorSchool } from "./fixtures";

const D = "2091-03-12"; // Senin
const D2 = "2091-03-13";
const SATURDAY = "2091-03-10";

let tenant: MonitorSchool;
let other: MonitorSchool;
let superToken = "";
let classY = "";
let foreignClass = "";
const ids: Record<string, string> = {};
let x1Nis = "";
let checkInId = "";
let selfieId = "";

interface DailyRow {
  student: { id: string; name: string; className: string | null };
  attendance: { status: string; flags: string[]; checkInTimeLocal: string | null } | null;
}

async function seedStudents(): Promise<{ classX: string }> {
  const classX = await createNamedClass(tenant, "VIII-A");
  classY = await createNamedClass(tenant, "VIII-B");
  const specs: Array<[string, string, string]> = [
    ["x1", "Ani X1", classX], ["x2", "Budi X2", classX], ["x3", "Citra X3", classX],
    ["y1", "Dedi Y1", classY], ["y2", "Eka Y2", classY], ["y3", "Fajar Y3", classY], ["y4", "Gita Y4", classY],
  ];
  for (const [key, name, classId] of specs) {
    const st = await createNamedStudent(tenant.school.id, name, { classId });
    ids[key] = st.id;
    if (key === "x1") x1Nis = st.nis;
  }
  await createNamedStudent(tenant.school.id, "Zaki Nonaktif", { classId: classX, status: "INACTIVE" });
  await createNamedStudent(tenant.school.id, "Wawan Baru", { classId: classX, activatedAt: new Date("2091-03-20T00:00:00Z") });
  return { classX };
}

async function seedCheckIn(classX: string, uploaderId: string): Promise<void> {
  const file = await createStoredFile(uploaderId, "ATTENDANCE_SELFIE", { schoolId: tenant.school.id, attachedAt: new Date() });
  selfieId = file.id;
  const row = await prisma.attendance.create({
    data: {
      schoolId: tenant.school.id, studentId: ids.x1!, classId: classX, date: toDbDate(D2), status: "HADIR", source: "CHECKIN",
      checkInAt: instantAtLocal(D2, 405, "WIB"), latitude: "-6.9147500", longitude: "107.6098500", accuracyM: 8, distanceM: 12,
      isMocked: false, deviceId: "device-x1", selfieFileId: file.id, hasAnomaly: true, anomalyFlags: ["SHARED_DEVICE", "STALE_FIX"],
    },
  });
  checkInId = row.id;
  const audit = (action: string, at: string) => ({
    schoolId: tenant.school.id, entityType: "Attendance", entityId: row.id, action, createdAt: new Date(at), after: { status: "HADIR", token: "rahasia" },
  });
  await prisma.auditLog.createMany({ data: [audit("attendance.correct", "2091-03-13T05:00:00Z"), audit("attendance.sweep", "2091-03-13T09:00:00Z")] });
  const rejection = (reason: "OUTSIDE_GEOFENCE" | "MOCK_LOCATION", at: string, coords: boolean) => ({
    schoolId: tenant.school.id, studentId: ids.x1!, date: toDbDate(D2), reason, createdAt: new Date(at),
    latitude: coords ? "-6.9200000" : null, longitude: coords ? "107.6200000" : null, accuracyM: 20, distanceM: coords ? 1300 : null,
  });
  await prisma.checkInRejection.createMany({
    data: [rejection("MOCK_LOCATION", "2091-03-12T23:20:00Z", false), rejection("OUTSIDE_GEOFENCE", "2091-03-12T23:10:00Z", true)],
  });
}

before(async () => {
  tenant = await createMonitorSchool();
  other = await createMonitorSchool();
  superToken = await createSuperToken();
  foreignClass = await createNamedClass(other, "IX");
  const { classX } = await seedStudents();
  const s = tenant.school.id;
  await addRows([
    { schoolId: s, studentId: ids.x1!, classId: classX, date: D, status: "HADIR", latitude: "-6.9148000", longitude: "107.6099000", accuracyM: 10, distanceM: 30,
      checkInAt: instantAtLocal(D, 410, "WIB"), hasAnomaly: true, anomalyFlags: ["SHARED_DEVICE"] },
    { schoolId: s, studentId: ids.x2!, classId: classX, date: D, status: "TERLAMBAT", lateMinutes: 12, latitude: "-6.9146000", longitude: "107.6097000", accuracyM: 15, distanceM: 20 },
    { schoolId: s, studentId: ids.y1!, classId: classY, date: D, status: "IZIN" },
    { schoolId: s, studentId: ids.y2!, classId: classY, date: D, status: "ALPHA" },
  ]);
  await prisma.checkInRejection.create({ data: { schoolId: s, studentId: ids.x2!, date: toDbDate(D), reason: "GPS_ACCURACY_TOO_LOW", accuracyM: 150, createdAt: new Date("2091-03-12T00:05:00Z") } });
  await seedCheckIn(classX, tenant.adminId);
});
after(disconnect);

const get = <T>(handler: Parameters<typeof callRoute>[0], url: string, token = tenant.adminToken, params?: Record<string, string>) =>
  callRoute<Envelope<T>>(handler, { method: "GET", url, bearer: token, params });

test("kartu hari ini: layak = siswa ACTIVE yang sudah aktif; hadir termasuk terlambat; hari non-sekolah null", async () => {
  const morning = await getTodayStats(adminCtx(tenant, new Date(`${D}T03:00:00Z`)), undefined);
  assert.deepEqual(morning, {
    date: D, isSchoolDay: true, isClosed: false, eligible: 7, present: 2, late: 1, izin: 1, sakit: 0, alpha: 1, notYet: 3, presentPct: 28.6,
  });
  const evening = await getTodayStats(adminCtx(tenant, new Date(`${D}T09:00:00Z`)), undefined);
  assert.equal(evening.isClosed, true);
  const weekend = await getTodayStats(adminCtx(tenant, new Date(`${SATURDAY}T03:00:00Z`)), undefined);
  assert.deepEqual([weekend.isSchoolDay, weekend.notYet, weekend.presentPct], [false, 0, null]);
});

test("Data Absensi: semua siswa layak urut kelas lalu nama, baris tanpa catatan = belum absen", async () => {
  const res = await get<DailyRow[]>(dailyRoute, `/api/v1/school/attendance/daily?date=${D}`);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data.map((r) => [r.student.name, r.attendance?.status ?? null]), [
    ["Ani X1", "HADIR"], ["Budi X2", "TERLAMBAT"], ["Citra X3", null],
    ["Dedi Y1", "IZIN"], ["Eka Y2", "ALPHA"], ["Fajar Y3", null], ["Gita Y4", null],
  ]);
  assert.deepEqual(res.body?.data[0]?.attendance?.flags, ["SHARED_DEVICE"]);
  assert.equal(res.body?.data[0]?.attendance?.checkInTimeLocal, "06:50");
  assert.deepEqual(res.body?.meta, { total: 7, page: 1, limit: 20, totalPages: 1 });
});

test("Data Absensi: filter BELUM_ABSEN berhalaman, status, anomali, kelas, pencarian, hari libur", async () => {
  const base = `/api/v1/school/attendance/daily?date=${D}`;
  const page1 = await get<DailyRow[]>(dailyRoute, `${base}&status=BELUM_ABSEN&limit=2`);
  assert.deepEqual(page1.body?.data.map((r) => r.student.name), ["Citra X3", "Fajar Y3"]);
  assert.deepEqual(page1.body?.meta, { total: 3, page: 1, limit: 2, totalPages: 2 });
  const page2 = await get<DailyRow[]>(dailyRoute, `${base}&status=BELUM_ABSEN&limit=2&page=2`);
  assert.deepEqual(page2.body?.data.map((r) => [r.student.name, r.attendance]), [["Gita Y4", null]]);
  const names = async (qs: string) => (await get<DailyRow[]>(dailyRoute, `${base}${qs}`)).body?.data.map((r) => r.student.name);
  assert.deepEqual(await names("&status=HADIR"), ["Ani X1"]);
  assert.deepEqual(await names("&anomaly=any"), ["Ani X1"]);
  assert.deepEqual(await names(`&classId=${classY}`), ["Dedi Y1", "Eka Y2", "Fajar Y3", "Gita Y4"]);
  assert.deepEqual(await names("&q=budi"), ["Budi X2"]);
  assert.deepEqual(await names(`&q=${encodeURIComponent(x1Nis)}`), ["Ani X1"]);
  assert.deepEqual(await names("&q=%25"), []);
  const holiday = await get<DailyRow[]>(dailyRoute, `/api/v1/school/attendance/daily?date=${SATURDAY}&status=BELUM_ABSEN`);
  assert.deepEqual(holiday.body?.meta, { total: 0, page: 1, limit: 20, totalPages: 0 });
  const foreign = await get(dailyRoute, `${base}&classId=${foreignClass}`);
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body?.error?.code, "CLASS_NOT_FOUND");
  for (const qs of ["?date=2091-02-30", "?status=FOO", "?limit=500", "?anomaly=unreviewed"]) {
    assert.equal((await get(dailyRoute, `/api/v1/school/attendance/daily${qs}`)).status, 400, qs);
  }
});

test("Peta: titik berkoordinat, unlocated (izin/alpha/belum absen), jumlah per status, truncated", async () => {
  const ctx = adminCtx(tenant, new Date(`${D}T03:00:00Z`));
  const { data, meta } = await getMap(ctx, { date: D });
  assert.deepEqual(data.school, { latitude: -6.9147, longitude: 107.6098, radiusM: 150 });
  assert.deepEqual(data.points.map((p) => [p.name, p.status, p.latitude, p.checkInTimeLocal, p.flags]).sort(), [
    ["Ani X1", "HADIR", -6.9148, "06:50", ["SHARED_DEVICE"]],
    ["Budi X2", "TERLAMBAT", -6.9146, null, []],
  ]);
  assert.deepEqual(data.unlocated.map((u) => [u.name, u.status]).sort(), [
    ["Citra X3", "BELUM_ABSEN"], ["Dedi Y1", "IZIN"], ["Eka Y2", "ALPHA"], ["Fajar Y3", "BELUM_ABSEN"], ["Gita Y4", "BELUM_ABSEN"],
  ]);
  assert.deepEqual(data.counts, { hadir: 1, terlambat: 1, izin: 1, sakit: 0, alpha: 1, notYet: 3 });
  assert.equal(data.rejected, undefined);
  assert.deepEqual([data.truncated, meta.truncated], [false, false]);
  const capped = await getMap(ctx, { date: D, includeRejected: true }, { maxItems: 1 });
  assert.deepEqual([capped.data.points.length, capped.data.unlocated.length, capped.data.rejected?.length], [1, 1, 1]);
  assert.deepEqual([capped.data.truncated, capped.meta.truncated], [true, true]);
  const waiting = await getMap(ctx, { date: D, status: "BELUM_ABSEN", classId: classY });
  assert.deepEqual([waiting.data.points.length, waiting.data.unlocated.map((u) => u.name)], [0, ["Fajar Y3", "Gita Y4"]]);
  assert.deepEqual(waiting.data.counts, { hadir: 0, terlambat: 0, izin: 1, sakit: 0, alpha: 1, notYet: 2 });
  const withRejected = await get<{ rejected: Array<{ reason: string; reasonLabel: string; name: string }> }>(mapRoute, `/api/v1/school/attendance/map?date=${D}&includeRejected=true`);
  assert.equal(withRejected.status, 200, JSON.stringify(withRejected.body?.error));
  assert.deepEqual(withRejected.body?.data.rejected.map((r) => [r.name, r.reason, r.reasonLabel]), [["Budi X2", "GPS_ACCURACY_TOO_LOW", "Akurasi GPS terlalu rendah"]]);
  assert.deepEqual(withRejected.body?.meta, { truncated: false });
});

test("Rekap Kelas: eligible = tercatat + belum absen per kelas, total", async () => {
  const res = await get<{ classes: Array<Record<string, unknown>>; totals: Record<string, unknown>; isSchoolDay: boolean }>(recapRoute, `/api/v1/school/attendance/recap?date=${D}`);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data.classes.map((c) => [c.eligible, c.hadir, c.terlambat, c.izin, c.alpha, c.notYet, c.presentPct]), [
    [3, 1, 1, 0, 0, 1, 66.7],
    [4, 0, 0, 1, 1, 2, 0],
  ]);
  assert.deepEqual(res.body?.data.totals, { eligible: 7, hadir: 1, terlambat: 1, izin: 1, sakit: 0, alpha: 1, notYet: 3, presentPct: 28.6 });
  const holiday = await get<{ isSchoolDay: boolean; totals: { presentPct: number | null; eligible: number } }>(recapRoute, `/api/v1/school/attendance/recap?date=${SATURDAY}`);
  assert.deepEqual([holiday.body?.data.isSchoolDay, holiday.body?.data.totals.eligible, holiday.body?.data.totals.presentPct], [false, 0, null]);
});

interface Detail {
  source: string;
  checkInTimeLocal: string;
  flags: Array<{ code: string; label: string; severity: string }>;
  selfie: { fileId: string; url: string | null; purged: boolean } | null;
  rejectionsSameDay: Array<{ reason: string; timeLocal: string; latitude: number | null }>;
  audit: Array<{ action: string; after: Record<string, unknown> }>;
  student: { name: string };
}

test("detail catatan: selfie, flag berlabel, penolakan hari itu, audit terbaru dulu; IDOR 404", async () => {
  const url = `/api/v1/school/attendance/${checkInId}`;
  const res = await get<Detail>(detailRoute, url, tenant.adminToken, { id: checkInId });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const detail = res.body?.data;
  assert.equal(detail?.source, "CHECKIN");
  assert.equal(detail?.checkInTimeLocal, "06:45");
  assert.equal(detail?.student.name, "Ani X1");
  assert.deepEqual(detail?.selfie, { fileId: selfieId, url: `/api/v1/files/${selfieId}`, purged: false });
  assert.deepEqual(detail?.flags.map((f) => [f.code, f.severity]), [["SHARED_DEVICE", "HIGH"], ["STALE_FIX", "LOW"]]);
  assert.deepEqual(detail?.rejectionsSameDay.map((r) => [r.reason, r.timeLocal, r.latitude]), [["OUTSIDE_GEOFENCE", "06:10", -6.92], ["MOCK_LOCATION", "06:20", null]]);
  assert.deepEqual(detail?.audit.map((a) => a.action), ["attendance.sweep", "attendance.correct"]);
  assert.deepEqual(detail?.audit[0]?.after, { status: "HADIR" }, "kunci rahasia diredaksi");
  const viaSuper = await get<Detail>(detailRoute, withSchool(url, tenant.school.id), superToken, { id: checkInId });
  assert.equal(viaSuper.status, 200);
  assert.equal((await get(detailRoute, url, other.adminToken, { id: checkInId })).status, 404);
  assert.equal((await get(detailRoute, withSchool(url, other.school.id), superToken, { id: checkInId })).status, 404);
  await prisma.storedFile.update({ where: { id: selfieId }, data: { deletedAt: new Date() } });
  const purged = await get<Detail>(detailRoute, url, tenant.adminToken, { id: checkInId });
  assert.deepEqual(purged.body?.data.selfie, { fileId: selfieId, url: null, purged: true });
});

test("anomali: rentang default/eksplisit, filter kelas, validasi rentang", async () => {
  const res = await get<Array<{ date: string; student: { name: string } }>>(anomaliesRoute, `/api/v1/school/attendance/anomalies?from=${D}&to=${D2}`);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data.map((r) => [r.date, r.student.name]), [[D2, "Ani X1"], [D, "Ani X1"]]);
  const none = await get<unknown[]>(anomaliesRoute, `/api/v1/school/attendance/anomalies?from=${D}&to=${D2}&classId=${classY}`);
  assert.deepEqual(none.body?.data, []);
  assert.equal((await get(anomaliesRoute, "/api/v1/school/attendance/anomalies?from=2091-03-13&to=2091-03-12")).status, 400);
  assert.equal((await get(anomaliesRoute, "/api/v1/school/attendance/anomalies?from=2091-01-01&to=2091-04-03")).status, 400);
  assert.equal((await get(anomaliesRoute, "/api/v1/school/attendance/anomalies?from=2020-01-01")).status, 400);
  assert.equal((await get(anomaliesRoute, `/api/v1/school/attendance/anomalies?classId=${foreignClass}`)).status, 404);
});

test("percobaan ditolak: per tanggal, per siswa (semua tanggal), siswa sekolah lain 404", async () => {
  const byDate = await get<Array<{ reason: string; student: { name: string }; date: string }>>(rejectionsRoute, `/api/v1/school/attendance/rejections?date=${D2}`);
  assert.equal(byDate.status, 200, JSON.stringify(byDate.body?.error));
  assert.deepEqual(byDate.body?.data.map((r) => r.reason), ["MOCK_LOCATION", "OUTSIDE_GEOFENCE"]);
  const byStudent = await get<Array<{ date: string }>>(rejectionsRoute, `/api/v1/school/attendance/rejections?studentId=${ids.x2}`);
  assert.deepEqual(byStudent.body?.data.map((r) => r.date), [D]);
  const foreignStudent = await createNamedStudent(other.school.id, "Asing");
  assert.equal((await get(rejectionsRoute, `/api/v1/school/attendance/rejections?studentId=${foreignStudent.id}`)).status, 404);
});
