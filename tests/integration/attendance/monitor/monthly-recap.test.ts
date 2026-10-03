/**
 * Rekap bulanan per kelas + ekspor Excel (A3) pada Maret 2091 (WIB, Sen-Jum, semester 2091-01-02..06-29):
 * matriks & total (L, K, hari belum ditutup DIHITUNG, hari berjalan tampil tapi tidak dihitung), keanggotaan
 * (snapshot kelas, pindah kelas, anggota tanpa baris), konsistensi dengan analitik kelas / bulan siswa / rapor,
 * validasi & batas, ekspor (satu kelas, semua kelas + "Tanpa kelas"), audit, kuota hanya untuk unduhan berhasil, tanpa NISN.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { GET as exportRoute } from "@/app/api/v1/school/attendance/monthly-recap/export/route";
import { GET as recapRoute } from "@/app/api/v1/school/attendance/monthly-recap/route";
import { getClassAnalytics, getStudentMonth } from "@/lib/attendance/analytics-queries";
import { exportMonthlyRecap } from "@/lib/attendance/monthly-recap-export";
import { getMonthlyRecap } from "@/lib/attendance/monthly-recap-queries";
import type { MonthlyRecapDto } from "@/lib/attendance/monthly-recap-schemas";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { makePrincipal } from "@/lib/auth/test-principal";
import { termAttendanceByStudent } from "@/lib/report-cards/attendance";
import { resolveSchoolScope } from "@/lib/tenant/scope";
import { toDbDate, eachDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { TERM_END, TERM_START, addRows, adminCtx, createMonitorSchool, createNamedClass, createNamedStudent, createSuperToken, webToken, withSchool, type MonitorSchool, type RowInput } from "./fixtures";

const CLOSED_NOW = new Date("2091-04-10T10:00:00Z"); // 17:00 WIB: seluruh Maret lewat
const MID_MONTH_NOW = new Date("2091-03-06T05:00:00Z"); // 12:00 WIB Selasa 6 Maret: closedThrough = 5 Maret
const MONTH = "2091-03";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

let tenant: MonitorSchool;
let other: MonitorSchool;
let superToken = "";
let classA = "";
let classAName = "";
let classB = "";
let foreignClass = "";
const ids: Record<string, string> = {};
const nisns: string[] = [];

before(async () => {
  tenant = await createMonitorSchool();
  other = await createMonitorSchool();
  superToken = await createSuperToken();
  classA = await createNamedClass(tenant, "X-A");
  classB = await createNamedClass(tenant, "X-B");
  foreignClass = await createNamedClass(other, "X-A");
  classAName = (await prisma.schoolClass.findFirstOrThrow({ where: { id: classA, schoolId: tenant.school.id } })).name;
  const specs: Array<[string, string, string]> = [
    ["ani", "Ani", classA], ["budi", "Budi", classA], ["citra", "Citra", classA], ["dodi", "Dodi", classB],
    ["eka", "Eka", classB], ["fajar", "Fajar", classA], ["gita", "Gita", classA], ["hadi", "Hadi", classA],
  ];
  for (const [key, name, classId] of specs) {
    const st = await createNamedStudent(tenant.school.id, name, { classId });
    ids[key] = st.id;
    nisns.push((await prisma.student.findFirstOrThrow({ where: { id: st.id, schoolId: tenant.school.id }, select: { nisn: true } })).nisn);
  }
  const s = tenant.school.id;
  const row = (key: string, classId: string | null, date: string, status: RowInput["status"], extra: Partial<RowInput> = {}): RowInput => ({
    schoolId: s, studentId: ids[key]!, classId, date: `2091-03-${date}`, status, ...extra,
  });
  await addRows([
    row("ani", classA, "05", "HADIR"), row("ani", classA, "06", "HADIR"), row("ani", classA, "07", "TERLAMBAT", { lateMinutes: 12, lateReasonCategory: "WEATHER" }),
    row("ani", classA, "12", "HADIR"), // hari belum ditutup: tetap dihitung
    row("budi", classA, "05", "HADIR"), row("budi", classA, "06", "IZIN"), row("budi", classA, "07", "ALPHA"), row("budi", classA, "08", "SAKIT"),
    row("citra", classA, "05", "HADIR"),
    // Dodi pindah ke B di tengah bulan: dua hari di A, satu di B.
    row("dodi", classA, "05", "HADIR"), row("dodi", classA, "06", "TERLAMBAT", { lateMinutes: 10 }), row("dodi", classB, "20", "HADIR"),
    row("eka", classB, "20", "HADIR"),
    // Gita (anggota A sekarang) hanya tercatat di B bulan ini -> tidak muncul di A.
    row("gita", classB, "21", "HADIR"),
    // Hadi: satu hari tanpa kelas, satu hari di A.
    row("hadi", null, "07", "HADIR"), row("hadi", classA, "08", "HADIR"),
  ]);
  await addRows([{ schoolId: other.school.id, studentId: (await createNamedStudent(other.school.id, "Asing", { classId: foreignClass })).id, classId: foreignClass, date: "2091-03-05", status: "ALPHA" }]);
  await prisma.holiday.create({ data: { schoolId: s, name: "Libur Uji Rekap", startDate: toDbDate("2091-03-14"), endDate: toDbDate("2091-03-14") } });
  const closedDates = eachDate("2091-01-02", "2091-04-10").filter((d) => d !== "2091-03-12" && d !== "2091-03-13");
  await prisma.jobRun.createMany({ data: closedDates.map((runKey) => ({ job: "auto-alpha", scopeKey: s, runKey, status: "SUCCEEDED" as const, finishedAt: CLOSED_NOW })) });
});
beforeEach(() => resetAllLimiters());
after(disconnect);

const recapOf = (now: Date, classId = classA, month = MONTH) => getMonthlyRecap(adminCtx(tenant, now), { classId, month });
const byName = (recap: MonthlyRecapDto) => new Map(recap.students.map((st) => [st.name, st]));
const cellOn = (recap: MonthlyRecapDto, name: string, day: number) => byName(recap).get(name)?.cells[day - 1];

test("matriks & total: L, K, pindah kelas, anggota tanpa baris, hari belum ditutup dihitung", async () => {
  const recap = await recapOf(CLOSED_NOW);
  assert.deepEqual([recap.month, recap.monthLabel, recap.class.id, recap.closedThrough, recap.isFinal], [MONTH, "Maret 2091", classA, "2091-04-10", false]);
  assert.deepEqual(recap.unclosedDates, ["2091-03-12", "2091-03-13"]);
  assert.equal(recap.days.length, 31);
  assert.deepEqual(recap.days.slice(0, 4).map((d) => [d.day, d.weekday, d.reason, d.closure]), [[1, 4, "SCHOOL_DAY", "CLOSED"], [2, 5, "SCHOOL_DAY", "CLOSED"], [3, 6, "DAY_OFF", "CLOSED"], [4, 7, "DAY_OFF", "CLOSED"]]);
  assert.deepEqual([recap.days[11]?.closure, recap.days[13]?.reason, recap.days[13]?.holidayName], ["UNCLOSED", "HOLIDAY", "Libur Uji Rekap"]);
  assert.deepEqual(recap.students.map((st) => st.name), ["Ani", "Budi", "Citra", "Dodi", "Fajar", "Hadi"], "Gita (baris hanya di B) & Eka tidak ikut");
  assert.deepEqual([5, 6, 7, 12].map((d) => cellOn(recap, "Ani", d)), ["H", "H", "T", "H"]);
  const ani = byName(recap).get("Ani")!;
  assert.deepEqual([ani.totals.recorded, ani.totals.hadir, ani.totals.terlambat, ani.totals.presentPct, ani.totals.lateMinutes], [4, 3, 1, 100, 12]);
  assert.deepEqual([ani.totals.lateReasons.filled, ani.totals.lateReasons.categories.find((c) => c.category === "WEATHER")?.count], [1, 1]);
  assert.deepEqual([5, 6, 20].map((d) => cellOn(recap, "Dodi", d)), ["H", "T", "K"]);
  const dodi = byName(recap).get("Dodi")!;
  assert.deepEqual([dodi.totals.recorded, dodi.otherClasses.map((c) => c.id)], [2, [classB]]);
  assert.match(dodi.otherClasses[0]?.name ?? "", /^X-B-/);
  assert.deepEqual([7, 8].map((d) => cellOn(recap, "Hadi", d)), ["K", "H"]);
  assert.deepEqual(byName(recap).get("Hadi")?.otherClasses, [{ id: null, name: "Tanpa kelas" }]);
  const fajar = byName(recap).get("Fajar")!;
  assert.deepEqual([fajar.cells.every((c) => c === null), fajar.totals.recorded, fajar.totals.presentPct, fajar.studentStatus], [true, 0, null, "ACTIVE"]);
  assert.deepEqual(
    [recap.totals.recorded, recap.totals.hadir, recap.totals.terlambat, recap.totals.izin, recap.totals.sakit, recap.totals.alpha, recap.totals.lateMinutes],
    [12, 7, 2, 1, 1, 1, 22],
  );
  const json = JSON.stringify(recap);
  assert.doesNotMatch(json, /nisn/i);
  for (const nisn of nisns) assert.equal(json.includes(nisn), false, "NISN tidak pernah dikirim");
});

test("konsistensi: total kelas = analitik kelas; siswa satu kelas = bulan siswa admin; Jan-Apr = rekap rapor", async () => {
  const recap = await recapOf(CLOSED_NOW);
  const { data } = await getClassAnalytics(adminCtx(tenant, CLOSED_NOW), { month: MONTH });
  const analytics = data.classes.find((c) => c.classId === classA)!;
  assert.deepEqual(
    [analytics.recorded, analytics.counts.hadir, analytics.counts.terlambat, analytics.counts.izin, analytics.counts.sakit, analytics.counts.alpha, analytics.presentPct],
    [recap.totals.recorded, recap.totals.hadir, recap.totals.terlambat, recap.totals.izin, recap.totals.sakit, recap.totals.alpha, recap.totals.presentPct],
  );
  for (const key of ["ani", "budi"]) {
    const month = (await getStudentMonth(adminCtx(tenant, CLOSED_NOW), ids[key]!, { month: MONTH })).data.summary;
    const totals = recap.students.find((st) => st.studentId === ids[key])!.totals;
    assert.deepEqual([month.recorded, month.present, month.late, month.izin, month.sakit, month.alpha, month.presentPct], [totals.recorded, totals.present, totals.terlambat, totals.izin, totals.sakit, totals.alpha, totals.presentPct], key);
  }
  const term = await prisma.term.findFirstOrThrow({ where: { schoolId: tenant.school.id } });
  const clock = { id: tenant.school.id, timezone: "WIB" as const, dayEndMinute: tenant.school.dayEndMinute, activeTermId: term.id, schoolDaysMask: tenant.school.schoolDaysMask, createdAt: tenant.school.createdAt };
  const card = await termAttendanceByStudent(prisma, resolveSchoolScope(makePrincipal({ role: "SCHOOL_ADMIN", schoolId: tenant.school.id })), { id: term.id, label: "Genap", academicYearId: term.academicYearId, startDate: TERM_START, endDate: TERM_END }, clock, [ids.budi!], CLOSED_NOW);
  let sum = { sick: 0, permit: 0, absent: 0 };
  for (const month of ["2091-01", "2091-02", "2091-03", "2091-04"]) {
    const totals = (await recapOf(CLOSED_NOW, classA, month)).students.find((st) => st.studentId === ids.budi)?.totals;
    sum = { sick: sum.sick + (totals?.sakit ?? 0), permit: sum.permit + (totals?.izin ?? 0), absent: sum.absent + (totals?.alpha ?? 0) };
  }
  assert.deepEqual(card.summaries.get(ids.budi!), sum);
});

test("bulan berjalan: hari setelah closedThrough tampil (kode) tetapi tidak dihitung", async () => {
  const recap = await recapOf(MID_MONTH_NOW);
  assert.equal(recap.closedThrough, "2091-03-05");
  assert.deepEqual([recap.days[4]?.closure, recap.days[5]?.closure], ["CLOSED", "OPEN"]);
  assert.deepEqual([5, 6, 7].map((d) => cellOn(recap, "Ani", d)), ["H", "H", "T"]);
  assert.equal(byName(recap).get("Ani")?.totals.recorded, 1);
  assert.equal(recap.isFinal, false);
});

test("route: validasi, kelas sekolah lain 404, super admin wajib schoolId, batas siswa 422", async () => {
  const get = (url: string, token = tenant.adminToken) => callRoute<Envelope<MonthlyRecapDto>>(recapRoute, { method: "GET", url, bearer: token });
  const base = "/api/v1/school/attendance/monthly-recap";
  const ok = await get(`${base}?classId=${classA}&month=${MONTH}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
  assert.equal(ok.body?.data.students.length, 6);
  for (const qs of ["", "?month=2091-03", `?classId=${classA}&month=2091-13`]) assert.equal((await get(`${base}${qs}`)).status, 400, qs);
  const foreign = await get(`${base}?classId=${foreignClass}&month=${MONTH}`);
  assert.deepEqual([foreign.status, foreign.body?.error?.code], [404, "CLASS_NOT_FOUND"]);
  assert.equal((await get(`${base}?classId=${classA}`, superToken)).status, 400);
  assert.equal((await get(withSchool(`${base}?classId=${classA}&month=${MONTH}`, tenant.school.id), superToken)).status, 200);
  await assert.rejects(getMonthlyRecap(adminCtx(tenant, CLOSED_NOW), { classId: classA, month: MONTH }, { students: 3, rows: 1000 }), { status: 422, code: "RECAP_TOO_LARGE" });
  await assert.rejects(getMonthlyRecap(adminCtx(tenant, CLOSED_NOW), { classId: classA, month: MONTH }, { students: 50, rows: 5 }), { status: 422, code: "RECAP_TOO_LARGE" });
});

async function workbookOf(response: Response): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
  return workbook;
}

test("ekspor satu kelas: header lampiran, isi sama dengan layar, audit, tanpa NISN", async () => {
  const res = await callRoute(exportRoute, { method: "GET", url: `/api/v1/school/attendance/monthly-recap/export?classId=${classA}&month=${MONTH}`, bearer: tenant.adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), XLSX);
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="rekap-kehadiran-x-a-[a-z0-9-]+-2091-03\.xlsx"$/);
  assert.equal(res.headers.get("cache-control"), "no-store");

  const response = await exportMonthlyRecap(adminCtx(tenant, CLOSED_NOW), { classId: classA, month: MONTH });
  const workbook = await workbookOf(response);
  assert.deepEqual(workbook.worksheets.map((s) => s.name), [classAName, "Keterangan"]);
  const sheet = workbook.worksheets[0]!;
  assert.equal(sheet.getCell("A1").value, `Rekap Kehadiran ${classAName} — Maret 2091`);
  assert.match(String(sheet.getCell("A2").value), /Data final s\.d\. 31 Maret 2091 · Diunduh 10\/04\/2091 17\.00 WIB$/);
  assert.match(String(sheet.getCell("A3").value), /2 hari belum ditutup/);
  assert.deepEqual([7, 8, 9, 10, 11, 12].map((r) => sheet.getCell(r, 3).value), ["Ani", "Budi", "Citra", "Dodi", "Fajar", "Hadi"]);
  assert.equal(sheet.getCell(13, 3).value, "Jumlah kelas");
  assert.equal(sheet.getCell(13, 3 + 31 + 1).value, 7, "H kelas = layar");
  const text = JSON.stringify(workbook.worksheets.map((s) => s.getSheetValues()));
  for (const nisn of nisns) assert.equal(text.includes(nisn), false);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "attendance.recap_export", entityId: classA }, orderBy: { createdAt: "desc" } });
  assert.deepEqual([audit.entityType, audit.schoolId, audit.after], ["SchoolClass", tenant.school.id, { month: MONTH, classCount: 1, studentCount: 6, isFinal: false }]);
});

test("ekspor semua kelas: satu sheet per kelas + Tanpa kelas + Keterangan; audit School", async () => {
  const workbook = await workbookOf(await exportMonthlyRecap(adminCtx(tenant, CLOSED_NOW), { month: MONTH }));
  const names = workbook.worksheets.map((s) => s.name);
  assert.equal(names.length, 4);
  assert.match(names[0]!, /^X-A-/);
  assert.match(names[1]!, /^X-B-/);
  assert.deepEqual(names.slice(2), ["Tanpa kelas", "Keterangan"]);
  const b = workbook.worksheets[1]!;
  assert.deepEqual([7, 8, 9].map((r) => b.getCell(r, 3).value), ["Dodi", "Eka", "Gita"]);
  assert.equal(workbook.worksheets[2]!.getCell(7, 3).value, "Hadi");
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "attendance.recap_export", entityId: tenant.school.id }, orderBy: { createdAt: "desc" } });
  assert.deepEqual([audit.entityType, (audit.after as { classCount: number }).classCount], ["School", 3]);
  await assert.rejects(exportMonthlyRecap(adminCtx(tenant, CLOSED_NOW), { month: MONTH }, { students: 3, rows: 1000 }), { status: 422, code: "RECAP_TOO_LARGE" });
});

test("kuota ekspor: hanya unduhan berhasil yang dihitung; ke-31 -> 429", async () => {
  const admin = await createSchoolAdmin(tenant.school.id);
  const token = await webToken(admin.id);
  const call = (classId: string) => callRoute(exportRoute, { method: "GET", url: `/api/v1/school/attendance/monthly-recap/export?classId=${classId}&month=2091-02`, bearer: token });
  for (let i = 0; i < 3; i++) assert.equal((await call(foreignClass)).status, 404);
  for (let i = 0; i < 30; i++) assert.equal((await call(classB)).status, 200, `unduhan ${i + 1}`);
  const limited = await call(classB);
  assert.equal(limited.status, 429);
  assert.equal((limited.body as Envelope | null)?.error?.code, "RATE_LIMITED");
});

test("ekspor bersamaan: akun yang sama ditolak 429 selagi ekspornya berjalan (tanpa memakai kuota); setelah selesai boleh lagi", async () => {
  const ctx = adminCtx(tenant, CLOSED_NOW);
  const first = exportMonthlyRecap(ctx, { month: MONTH });
  await assert.rejects(exportMonthlyRecap(ctx, { month: MONTH }), { status: 429, code: "RATE_LIMITED" });
  assert.equal((await first).status, 200);
  assert.equal((await exportMonthlyRecap(ctx, { month: MONTH })).status, 200);
});
