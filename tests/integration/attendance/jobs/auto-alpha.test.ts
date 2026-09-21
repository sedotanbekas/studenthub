import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { runAutoAlpha } from "@/lib/attendance/auto-alpha-job";
import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { sweepSharedDevice } from "@/lib/attendance/sweep";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createClass, createStudent } from "../../helpers/factories";
import { checkInRow, createAttendanceSchool, jobCtx, leaveRequest, nationalHolidayDates } from "./fixtures";

/**
 * Tanggal tetap di 2031 (tidak bentrok dengan libur nasional hasil impor 2026-2027). Selasa 18 Maret 2031
 * 09:00Z = 16:00 WIB (lewat dayEnd 15:00) = 18:00 WIT.
 */
const D = "2031-03-18";
const NOW = new Date("2031-03-18T09:00:00Z");
const TERM = { termStart: "2031-01-06", termEnd: "2031-06-20" } as const;
const ACTIVATED = new Date("2031-01-10T00:00:00Z");

before(async () => {
  const blocked = await nationalHolidayDates("2031-03-10", "2031-03-20");
  assert.equal(blocked.size, 0, "DB uji tidak boleh punya libur nasional di rentang tanggal tetap test ini");
});
after(disconnect);

/** Sekolah yang dibuat pagi hari D: satu-satunya kandidat penutupan = D. */
const schoolOnD = (timezone: "WIB" | "WIT" = "WIB") => createAttendanceSchool({ timezone, createdAt: new Date(`${D}T00:00:00Z`), ...TERM });

const rowsOn = (schoolId: string, date = D) =>
  prisma.attendance.findMany({ where: { schoolId, date: toDbDate(date) }, orderBy: { studentId: "asc" } });

test("penutupan pertama membuat ALPHA untuk siswa layak; penutupan kedua 0 baris; satu JobRun SUCCEEDED", async () => {
  const school = await schoolOnD();
  const cls = await createClass(school.id, (await prisma.term.findFirstOrThrow({ where: { schoolId: school.id } })).academicYearId);
  const a = await createStudent(school.id, { classId: cls.id, activatedAt: ACTIVATED });
  const b = await createStudent(school.id, { activatedAt: ACTIVATED });
  await createStudent(school.id, { status: "INACTIVE", activatedAt: ACTIVATED });
  await createStudent(school.id, { status: "DRAFT" });
  await createStudent(school.id, { activatedAt: new Date("2031-03-18T17:30:00Z") }); // 19 Mar WIB: belum aktif pada D

  const first = await runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }));
  assert.deepEqual(first, { schools: 1, ran: 1, skipped: 0, failed: 0, hasMore: false });
  const rows = await rowsOn(school.id);
  assert.deepEqual(
    rows.map((r) => [r.studentId, r.status, r.source, r.classId]).sort(),
    [[a.student.id, "ALPHA", "AUTO_ALPHA", cls.id], [b.student.id, "ALPHA", "AUTO_ALPHA", null]].sort(),
  );

  const second = await runAutoAlpha(jobCtx(new Date(NOW.getTime() + 60_000), { schoolIds: [school.id] }));
  assert.deepEqual(second, { schools: 1, ran: 0, skipped: 0, failed: 0, hasMore: false });
  assert.equal((await rowsOn(school.id)).length, 2);
  const runs = await prisma.jobRun.findMany({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id } });
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.runKey, D);
  assert.equal(runs[0]?.status, "SUCCEEDED");
  assert.deepEqual(runs[0]?.result, { date: D, planned: 2, inserted: 2, alphaPlanned: 2, leavePlanned: 0, anomaliesSwept: 0 });
});

test("hari libur sekolah -> JobRun SUCCEEDED dengan skipped NON_SCHOOL_DAY dan tanpa baris", async () => {
  const school = await schoolOnD();
  await createStudent(school.id, { activatedAt: ACTIVATED });
  await prisma.holiday.create({ data: { schoolId: school.id, name: uniq("Libur"), startDate: toDbDate(D), endDate: toDbDate(D) } });
  await runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }));
  assert.equal((await rowsOn(school.id)).length, 0);
  const run = await prisma.jobRun.findFirstOrThrow({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: D } });
  assert.equal(run.status, "SUCCEEDED");
  assert.deepEqual(run.result, { date: D, skipped: "NON_SCHOOL_DAY", reason: "HOLIDAY" });
});

test("izin DISETUJUI -> baris LEAVE (status = jenis izin); izin PENDING tidak melindungi -> ALPHA", async () => {
  const school = await schoolOnD();
  const approved = await createStudent(school.id, { activatedAt: ACTIVATED });
  const pending = await createStudent(school.id, { activatedAt: ACTIVATED });
  const leave = await leaveRequest({ schoolId: school.id, studentId: approved.student.id, from: "2031-03-17", to: "2031-03-19", status: "APPROVED", type: "SAKIT" });
  await leaveRequest({ schoolId: school.id, studentId: pending.student.id, from: D, to: D, status: "PENDING" });
  await runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }));
  const rows = await rowsOn(school.id);
  const byStudent = new Map(rows.map((r) => [r.studentId, r]));
  assert.equal(byStudent.get(approved.student.id)?.status, "SAKIT");
  assert.equal(byStudent.get(approved.student.id)?.source, "LEAVE");
  assert.equal(byStudent.get(approved.student.id)?.leaveRequestId, leave.id);
  assert.equal(byStudent.get(pending.student.id)?.status, "ALPHA");
  assert.equal(byStudent.get(pending.student.id)?.source, "AUTO_ALPHA");
});

test("dua eksekusi paralel -> hanya satu penutupan, tanpa baris ganda", async () => {
  const school = await schoolOnD();
  for (let i = 0; i < 5; i += 1) await createStudent(school.id, { activatedAt: ACTIVATED });
  const results = await Promise.all([runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] })), runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }))]);
  assert.equal(results.reduce((sum, r) => sum + Number(r.ran), 0), 1, JSON.stringify(results));
  assert.equal((await rowsOn(school.id)).length, 5);
  assert.equal(await prisma.jobRun.count({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, status: "SUCCEEDED" } }), 1);
});

test("sapuan SHARED_DEVICE menandai kedua baris perangkat bersama (tanpa duplikat flag) dan aman diulang", async () => {
  const school = await schoolOnD();
  const [s1, s2, s3, s4] = [
    await createStudent(school.id, { activatedAt: ACTIVATED }),
    await createStudent(school.id, { activatedAt: ACTIVATED }),
    await createStudent(school.id, { activatedAt: ACTIVATED }),
    await createStudent(school.id, { activatedAt: ACTIVATED }),
  ];
  const shared = uniq("dev");
  await checkInRow({ schoolId: school.id, studentId: s1.student.id, userId: s1.user.id, date: D, deviceId: shared, anomalyFlags: ["LOW_ACCURACY"] });
  await checkInRow({ schoolId: school.id, studentId: s2.student.id, userId: s2.user.id, date: D, deviceId: shared });
  await checkInRow({ schoolId: school.id, studentId: s3.student.id, userId: s3.user.id, date: D, deviceId: uniq("dev") });

  await runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }));
  const byStudent = new Map((await rowsOn(school.id)).map((r) => [r.studentId, r]));
  assert.deepEqual(byStudent.get(s1.student.id)?.anomalyFlags, ["LOW_ACCURACY", "SHARED_DEVICE"]);
  assert.equal(byStudent.get(s1.student.id)?.hasAnomaly, true);
  assert.deepEqual(byStudent.get(s2.student.id)?.anomalyFlags, ["SHARED_DEVICE"]);
  assert.equal(byStudent.get(s2.student.id)?.hasAnomaly, true);
  assert.equal(byStudent.get(s3.student.id)?.hasAnomaly, false);
  assert.equal(byStudent.get(s3.student.id)?.anomalyFlags, null);
  assert.equal(byStudent.get(s4.student.id)?.status, "ALPHA");
  const run = await prisma.jobRun.findFirstOrThrow({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id } });
  assert.equal((run.result as { anomaliesSwept: number }).anomaliesSwept, 2);
  assert.equal(await withTx((tx) => sweepSharedDevice(tx, school.id, D, NOW)), 0, "sapuan ulang tidak mengubah apa pun");
});

test("instant yang sama: sekolah WIT sudah lewat dayEnd (ditutup), sekolah WIB belum", async () => {
  const instant = new Date(`${D}T06:30:00Z`); // 15:30 WIT, 13:30 WIB
  const witSchool = await schoolOnD("WIT");
  const wibSchool = await schoolOnD("WIB");
  await createStudent(witSchool.id, { activatedAt: ACTIVATED });
  await createStudent(wibSchool.id, { activatedAt: ACTIVATED });
  const result = await runAutoAlpha(jobCtx(instant, { schoolIds: [witSchool.id, wibSchool.id] }));
  assert.equal(result.ran, 1);
  assert.equal((await rowsOn(witSchool.id)).length, 1);
  assert.equal((await rowsOn(wibSchool.id)).length, 0);
});

test("catch-up: hari yang terlewat (sejak createdAt, maks 7 hari) ditutup satu per satu", async () => {
  const school = await createAttendanceSchool({ createdAt: new Date("2031-03-14T20:00:00Z"), ...TERM }); // 15 Mar WIB
  const st = await createStudent(school.id, { activatedAt: ACTIVATED });
  const result = await runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }));
  assert.equal(result.ran, 4);
  const rows = await prisma.attendance.findMany({ where: { studentId: st.student.id }, orderBy: { date: "asc" } });
  assert.deepEqual(rows.map((r) => r.date.toISOString().slice(0, 10)), ["2031-03-15", "2031-03-16", "2031-03-17", D]);
});

test("anggaran waktu habis -> hasMore tanpa menutup apa pun", async () => {
  const school = await schoolOnD();
  await createStudent(school.id, { activatedAt: ACTIVATED });
  const result = await runAutoAlpha({ ...jobCtx(NOW, { schoolIds: [school.id] }), deadline: Date.now() - 1 });
  assert.deepEqual(result, { schools: 1, ran: 0, skipped: 0, failed: 0, hasMore: true });
  assert.equal((await rowsOn(school.id)).length, 0);
});

test("scope kosong tidak memindai sekolah mana pun", async () => {
  assert.deepEqual(await runAutoAlpha(jobCtx(NOW, { schoolIds: [] })), { schools: 0, ran: 0, skipped: 0, failed: 0, hasMore: false });
});
