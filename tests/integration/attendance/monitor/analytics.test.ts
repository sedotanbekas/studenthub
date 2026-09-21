/**
 * Analitik absensi pada bulan fixture (Maret 2091, Sen-Jum): persentase tepat per kelas & sekolah,
 * kelas snapshot (siswa pindah kelas di tengah bulan tetap dihitung di kelas lama untuk hari lama),
 * pemotongan closedThrough, unclosedDates dari JobRun auto-alpha, selisih bulan lalu, tren kelas &
 * siswa, dan tampilan bulan satu siswa. Service dipanggil langsung dengan jam yang diinjeksi.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as classAnalyticsRoute } from "@/app/api/v1/school/attendance/analytics/classes/route";
import { GET as studentTrendRoute } from "@/app/api/v1/school/attendance/analytics/students/[studentId]/route";
import { GET as classTrendRoute } from "@/app/api/v1/school/attendance/analytics/classes/[classId]/trend/route";
import { GET as summaryRoute } from "@/app/api/v1/school/attendance/analytics/summary/route";
import { GET as studentMonthRoute } from "@/app/api/v1/school/attendance/students/[studentId]/month/route";
import { getClassAnalytics, getClassTrend, getStudentMonth, getStudentTrend, getSummaryAnalytics } from "@/lib/attendance/analytics-queries";
import { eachDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { callRoute, type Envelope } from "../../helpers/request";
import {
  addRows,
  adminCtx,
  createMonitorSchool,
  createNamedClass,
  createNamedStudent,
  type MonitorSchool,
  type RowInput,
} from "./fixtures";

const CLOSED_NOW = new Date("2091-04-10T10:00:00Z"); // 17:00 WIB, April sudah berjalan
const MID_MONTH_NOW = new Date("2091-03-06T05:00:00Z"); // 12:00 WIB (sebelum dayEnd 15:00)

let tenant: MonitorSchool;
let other: MonitorSchool;
let classA = "";
let classB = "";
let moved = "";

before(async () => {
  tenant = await createMonitorSchool();
  other = await createMonitorSchool();
  classA = await createNamedClass(tenant, "VII-A");
  classB = await createNamedClass(tenant, "VII-B");
  const [a1, a2, a3, a4] = await Promise.all(["A1", "A2", "A3", "A4"].map((n) => createNamedStudent(tenant.school.id, `Siswa ${n}`, { classId: classA })));
  const m = await createNamedStudent(tenant.school.id, "Siswa Pindah", { classId: classB });
  const b1 = await createNamedStudent(tenant.school.id, "Siswa B1", { classId: classB });
  const foreign = await createNamedStudent(other.school.id, "Siswa Lain");
  moved = m.id;
  const s = tenant.school.id;
  const row = (studentId: string, classId: string, date: string, status: RowInput["status"]): RowInput => ({ schoolId: s, studentId, classId, date, status });
  await addRows([
    // Kelas A (snapshot): 6 HADIR, 2 TERLAMBAT, 1 IZIN, 1 ALPHA.
    row(a1!.id, classA, "2091-03-05", "HADIR"), row(a1!.id, classA, "2091-03-06", "HADIR"), row(a1!.id, classA, "2091-03-07", "TERLAMBAT"),
    row(a2!.id, classA, "2091-03-05", "HADIR"), row(a2!.id, classA, "2091-03-06", "IZIN"), row(a2!.id, classA, "2091-03-07", "HADIR"),
    row(a3!.id, classA, "2091-03-05", "HADIR"), row(a3!.id, classA, "2091-03-06", "ALPHA"),
    row(m.id, classA, "2091-03-05", "HADIR"), row(m.id, classA, "2091-03-06", "TERLAMBAT"),
    // Kelas B: siswa pindah (sekarang di B) + b1 -> 2 HADIR, 1 SAKIT.
    row(m.id, classB, "2091-03-20", "HADIR"), row(b1.id, classB, "2091-03-20", "HADIR"), row(b1.id, classB, "2091-03-21", "SAKIT"),
    // Februari: 3 hadir dari 4 -> 75%. April: di luar bulan.
    row(a1!.id, classA, "2091-02-26", "HADIR"), row(a2!.id, classA, "2091-02-26", "HADIR"),
    row(a3!.id, classA, "2091-02-26", "ALPHA"), row(a4!.id, classA, "2091-02-26", "HADIR"),
    row(a1!.id, classA, "2091-04-02", "HADIR"),
    // Sekolah lain di bulan yang sama tidak ikut terhitung.
    { schoolId: other.school.id, studentId: foreign.id, classId: null, date: "2091-03-05", status: "ALPHA" },
  ]);
  const closedDates = eachDate("2091-03-01", "2091-03-31").filter((d) => d !== "2091-03-12" && d !== "2091-03-13");
  await prisma.jobRun.createMany({
    data: closedDates.map((runKey) => ({ job: "auto-alpha", scopeKey: s, runKey, status: "SUCCEEDED" as const, finishedAt: CLOSED_NOW })),
  });
});
after(disconnect);

test("analitik kelas: persentase tepat per kelas snapshot + sekolah digabung + unclosedDates", async () => {
  const { data, meta } = await getClassAnalytics(adminCtx(tenant, CLOSED_NOW), { month: "2091-03" });
  assert.deepEqual(data.period, {
    month: "2091-03", from: "2091-03-01", to: "2091-03-31", closedThrough: "2091-04-10", isPartial: false,
    unclosedDates: ["2091-03-12", "2091-03-13"],
  });
  assert.deepEqual(meta, { isPartial: false, unclosedDates: ["2091-03-12", "2091-03-13"] });
  assert.deepEqual(data.school, {
    recorded: 13, presentPct: 76.9, latePct: 15.4, izinPct: 7.7, sakitPct: 7.7, alphaPct: 7.7,
    counts: { hadir: 8, terlambat: 2, izin: 1, sakit: 1, alpha: 1 },
  });
  assert.deepEqual(data.classes.map((c) => [c.classId, c.recorded, c.presentPct, c.latePct, c.izinPct, c.sakitPct, c.alphaPct]), [
    [classA, 10, 80, 20, 10, 0, 10],
    [classB, 3, 66.7, 0, 0, 33.3, 0],
  ]);
  assert.match(data.classes[0]?.className ?? "", /^VII-A-/);
});

test("analitik kelas: bulan berjalan dipotong di closedThrough (sebelum dayEnd = kemarin)", async () => {
  const { data } = await getClassAnalytics(adminCtx(tenant, MID_MONTH_NOW), { month: "2091-03" });
  assert.equal(data.period.closedThrough, "2091-03-05");
  assert.equal(data.period.isPartial, true);
  assert.deepEqual(data.period.unclosedDates, []);
  assert.deepEqual(data.classes.map((c) => [c.classId, c.recorded, c.presentPct]), [[classA, 4, 100]]);
  const future = await getClassAnalytics(adminCtx(tenant, MID_MONTH_NOW), { month: "2091-05" });
  assert.equal(future.data.school.recorded, 0);
  assert.equal(future.data.school.presentPct, null);
  assert.deepEqual(future.data.classes, []);
});

test("ringkasan bulan: donat + selisih poin persen terhadap bulan lalu", async () => {
  const summary = await getSummaryAnalytics(adminCtx(tenant, CLOSED_NOW), { month: "2091-03" });
  assert.equal(summary.recorded, 13);
  assert.equal(summary.presentPct, 76.9);
  assert.equal(summary.prevMonth, "2091-02");
  assert.equal(summary.prevPresentPct, 75);
  assert.equal(summary.deltaPp, 1.9);
  assert.equal(summary.isPartial, false);
  const february = await getSummaryAnalytics(adminCtx(tenant, CLOSED_NOW), { month: "2091-02" });
  assert.equal(february.presentPct, 75);
  assert.equal(february.prevPresentPct, null);
  assert.equal(february.deltaPp, null);
});

test("tren harian kelas memakai kelas snapshot; hari sekolah tanpa data -> null", async () => {
  const trendA = await getClassTrend(adminCtx(tenant, CLOSED_NOW), classA, { from: "2091-03-05", to: "2091-03-11" });
  assert.deepEqual(trendA.days.map((d) => [d.date, d.isSchoolDay, d.recorded, d.presentPct]), [
    ["2091-03-05", true, 4, 100],
    ["2091-03-06", true, 4, 50],
    ["2091-03-07", true, 2, 100],
    ["2091-03-08", true, 0, null],
    ["2091-03-09", true, 0, null],
  ]);
  const trendB = await getClassTrend(adminCtx(tenant, CLOSED_NOW), classB, { from: "2091-03-01", to: "2091-03-21" });
  assert.deepEqual(trendB.days.filter((d) => d.recorded > 0).map((d) => [d.date, d.recorded, d.presentPct]), [
    ["2091-03-20", 2, 100],
    ["2091-03-21", 1, 0],
  ]);
  const cut = await getClassTrend(adminCtx(tenant, MID_MONTH_NOW), classA, { from: "2091-03-05", to: "2091-03-09" });
  assert.deepEqual(cut.days.map((d) => d.date), ["2091-03-05"]);
});

test("tren bulanan siswa pindah kelas & tampilan bulan satu siswa", async () => {
  const trend = await getStudentTrend(adminCtx(tenant, CLOSED_NOW), moved, { months: 3 });
  assert.equal(trend.student.name, "Siswa Pindah");
  assert.deepEqual(trend.months.map((m) => [m.month, m.recorded, m.presentPct, m.latePct]), [
    ["2091-02", 0, null, null],
    ["2091-03", 3, 100, 33.3],
    ["2091-04", 0, null, null],
  ]);
  const { data, meta } = await getStudentMonth(adminCtx(tenant, CLOSED_NOW), moved, { month: "2091-03" });
  assert.deepEqual(meta, { prevMonth: "2091-02", nextMonth: "2091-04" });
  assert.deepEqual(data.days.map((d) => [d.date, d.status, d.source]), [
    ["2091-03-05", "HADIR", "ADMIN"],
    ["2091-03-06", "TERLAMBAT", "ADMIN"],
    ["2091-03-20", "HADIR", "ADMIN"],
  ]);
  assert.equal(data.nonSchoolDays.length, 9);
  assert.ok(data.nonSchoolDays.every((d) => d.reason === "DAY_OFF"));
  assert.deepEqual(data.summary, { recorded: 3, present: 3, late: 1, izin: 0, sakit: 0, alpha: 0, presentPct: 100 });
  const midMonth = await getStudentMonth(adminCtx(tenant, MID_MONTH_NOW), moved, { month: "2091-03" });
  assert.equal(midMonth.data.days.length, 3, "hari belum ditutup tetap tampil di daftar");
  assert.equal(midMonth.data.summary.recorded, 1, "ringkasan hanya hari yang sudah ditutup");
});

test("route analitik: 200 sesuai kontrak (jam nyata), 404 kelas/siswa sekolah lain, 400 rentang/bulan tidak valid", async () => {
  const token = tenant.adminToken;
  const classes = await callRoute<Envelope<{ school: { recorded: number } }>>(classAnalyticsRoute, { method: "GET", url: "/api/v1/school/attendance/analytics/classes?month=2091-03", bearer: token });
  assert.equal(classes.status, 200, JSON.stringify(classes.body?.error));
  assert.equal(classes.body?.data.school.recorded, 0, "bulan 2091 belum ditutup menurut jam nyata");
  assert.equal(classes.body?.meta?.isPartial, true);
  const summary = await callRoute(summaryRoute, { method: "GET", url: "/api/v1/school/attendance/analytics/summary", bearer: token });
  assert.equal(summary.status, 200, JSON.stringify(summary.body?.error));
  const badMonth = await callRoute(summaryRoute, { method: "GET", url: "/api/v1/school/attendance/analytics/summary?month=2091-13", bearer: token });
  assert.equal(badMonth.status, 400);

  const trendUrl = (classId: string, qs = "") => `/api/v1/school/attendance/analytics/classes/${classId}/trend${qs}`;
  const trend = await callRoute(classTrendRoute, { method: "GET", url: trendUrl(classA), params: { classId: classA }, bearer: token });
  assert.equal(trend.status, 200, JSON.stringify(trend.body?.error));
  const foreignClass = await createNamedClass(other, "X");
  const idor = await callRoute(classTrendRoute, { method: "GET", url: trendUrl(foreignClass), params: { classId: foreignClass }, bearer: token });
  assert.equal(idor.status, 404);
  assert.equal(idor.body?.error?.code, "CLASS_NOT_FOUND");
  const tooLong = await callRoute(classTrendRoute, { method: "GET", url: trendUrl(classA, "?from=2091-01-01&to=2091-04-03"), params: { classId: classA }, bearer: token });
  assert.equal(tooLong.status, 400);
  const fromOnly = await callRoute(classTrendRoute, { method: "GET", url: trendUrl(classA, "?from=2020-01-01"), params: { classId: classA }, bearer: token });
  assert.equal(fromOnly.status, 400);

  const studentUrl = `/api/v1/school/attendance/analytics/students/${moved}?months=12`;
  const studentTrend = await callRoute<Envelope<{ months: unknown[] }>>(studentTrendRoute, { method: "GET", url: studentUrl, params: { studentId: moved }, bearer: token });
  assert.equal(studentTrend.status, 200, JSON.stringify(studentTrend.body?.error));
  assert.equal(studentTrend.body?.data.months.length, 12);
  const tooMany = await callRoute(studentTrendRoute, { method: "GET", url: `/api/v1/school/attendance/analytics/students/${moved}?months=13`, params: { studentId: moved }, bearer: token });
  assert.equal(tooMany.status, 400);
  const foreignView = await callRoute(studentTrendRoute, { method: "GET", url: studentUrl, params: { studentId: moved }, bearer: other.adminToken });
  assert.equal(foreignView.status, 404);

  const monthUrl = `/api/v1/school/attendance/students/${moved}/month?month=2091-03`;
  const month = await callRoute<Envelope<{ days: unknown[] }>>(studentMonthRoute, { method: "GET", url: monthUrl, params: { studentId: moved }, bearer: token });
  assert.equal(month.status, 200, JSON.stringify(month.body?.error));
  assert.equal(month.body?.data.days.length, 3);
  assert.deepEqual(month.body?.meta, { prevMonth: "2091-02", nextMonth: "2091-04" });
  const foreignMonth = await callRoute(studentMonthRoute, { method: "GET", url: monthUrl, params: { studentId: moved }, bearer: other.adminToken });
  assert.equal(foreignMonth.status, 404);
});
