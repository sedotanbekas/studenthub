/**
 * Seed absensi demo (scripts/lib/demo-attendance.ts) pada sekolah uji dengan jam diinjeksi:
 * 10 hari sekolah terakhir sebelum hari ini, aktivasi siswa dihormati, baris asli tidak ditimpa,
 * ALPHA otomatis diganti data demo, idempoten, dan Peta menampilkan titik.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { ensureDemoAttendance } from "../../../../scripts/lib/demo-attendance";
import { getMap } from "@/lib/attendance/monitoring-queries";
import { fromDbDate, instantAtLocal, toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { disconnect, prisma } from "../../helpers/db";
import { createStoredFile, uniqNisn } from "../../helpers/factories";
import { adminCtx, createMonitorSchool, createNamedClass, createNamedStudent, type MonitorSchool } from "./fixtures";

const NOW = new Date("2091-03-20T03:00:00Z"); // Selasa 10:00 WIB
const EXPECTED_DATES = [
  "2091-03-06", "2091-03-07", "2091-03-08", "2091-03-09",
  "2091-03-12", "2091-03-13", "2091-03-14", "2091-03-15", "2091-03-16", "2091-03-19",
];

let tenant: MonitorSchool;
const nisns: string[] = [];
const studentIds: string[] = [];
let checkInRowId = "";
let correctionRowId = "";
let autoAlphaRowId = "";

before(async () => {
  tenant = await createMonitorSchool();
  const classId = await createNamedClass(tenant, "VII-A");
  for (let i = 0; i < 5; i += 1) {
    const nisn = uniqNisn();
    const activatedAt = i === 4 ? new Date("2091-03-13T17:30:00Z") : undefined; // 00:30 WIB 14 Maret
    const st = await createNamedStudent(tenant.school.id, `Demo ${i}`, { classId, nisn, ...(activatedAt ? { activatedAt } : {}) });
    nisns.push(nisn);
    studentIds.push(st.id);
  }
  const file = await createStoredFile(tenant.adminId, "ATTENDANCE_SELFIE", { schoolId: tenant.school.id, attachedAt: new Date() });
  const base = { schoolId: tenant.school.id, classId, date: toDbDate("2091-03-19") };
  checkInRowId = (await prisma.attendance.create({
    data: { ...base, studentId: studentIds[0]!, status: "HADIR", source: "CHECKIN", checkInAt: instantAtLocal("2091-03-19", 400, "WIB"), latitude: "-6.9", longitude: "107.6", selfieFileId: file.id },
  })).id;
  autoAlphaRowId = (await prisma.attendance.create({ data: { ...base, studentId: studentIds[1]!, status: "ALPHA", source: "AUTO_ALPHA" } })).id;
  correctionRowId = (await prisma.attendance.create({
    data: { ...base, date: toDbDate("2091-03-16"), studentId: studentIds[2]!, status: "SAKIT", source: "ADMIN", note: "koreksi wali kelas" },
  })).id;
});
after(disconnect);

const demoRows = () =>
  prisma.attendance.findMany({ where: { studentId: { in: studentIds } }, orderBy: [{ studentId: "asc" }, { date: "asc" }] });

test("seed demo: 10 hari sekolah terakhir sebelum hari ini, aktivasi dihormati, baris asli dipertahankan", async () => {
  const result = await withTx((tx) => ensureDemoAttendance(tx, tenant.school.id, nisns, NOW));
  assert.deepEqual(result, { created: 41, updated: 1 });
  const rows = await demoRows();
  assert.equal(rows.length, 44);
  assert.deepEqual([...new Set(rows.map((r) => fromDbDate(r.date)))].sort(), EXPECTED_DATES);
  const late = rows.filter((r) => r.studentId === studentIds[4]).map((r) => fromDbDate(r.date));
  assert.deepEqual(late, ["2091-03-14", "2091-03-15", "2091-03-16", "2091-03-19"]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  assert.equal(byId.get(checkInRowId)?.source, "CHECKIN");
  assert.deepEqual([byId.get(correctionRowId)?.status, byId.get(correctionRowId)?.note], ["SAKIT", "koreksi wali kelas"]);
  assert.deepEqual([byId.get(autoAlphaRowId)?.source, byId.get(autoAlphaRowId)?.note], ["ADMIN", "data demo"]);
  const demo = rows.filter((r) => r.note === "data demo");
  const statuses = new Set(demo.map((r) => r.status));
  assert.ok(statuses.has("HADIR") && statuses.has("TERLAMBAT"), [...statuses].join());
  for (const row of demo) {
    const located = row.status === "HADIR" || row.status === "TERLAMBAT";
    assert.equal(row.source, "ADMIN");
    assert.equal(row.latitude !== null && row.checkInAt !== null, located, `${row.status} ${fromDbDate(row.date)}`);
    assert.equal(row.lateMinutes !== null, row.status === "TERLAMBAT");
  }
});

test("seed demo idempoten & Peta menampilkan titik demo", async () => {
  const before = await demoRows();
  const again = await withTx((tx) => ensureDemoAttendance(tx, tenant.school.id, nisns, NOW));
  assert.deepEqual(again, { created: 0, updated: 0 });
  const afterRows = await demoRows();
  assert.deepEqual(afterRows.map((r) => [r.id, r.status, r.updatedAt.getTime()]), before.map((r) => [r.id, r.status, r.updatedAt.getTime()]));
  const { data } = await getMap(adminCtx(tenant, NOW), { date: "2091-03-19" });
  assert.ok(data.points.length >= 3, `titik: ${data.points.length}`);
  assert.ok(data.points.every((p) => Math.abs(p.latitude - -6.9147) < 0.001 || p.latitude === -6.9));
});
