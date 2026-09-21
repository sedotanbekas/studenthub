import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DELETE as deleteHolidayRoute } from "@/app/api/v1/school/holidays/[id]/route";
import { POST as createHolidayRoute } from "@/app/api/v1/school/holidays/route";
import { runAutoAlpha } from "@/lib/attendance/auto-alpha-job";
import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { onCalendarChanged } from "@/lib/attendance/calendar-sync";
import { addDays, instantAtLocal, toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createStudent, createSuperAdmin } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { holdTx, pause, webToken } from "../../academics/helpers";
import { actionCtx, adminRow, autoAlphaRow, checkInRow, createAttendanceSchool, jobCtx, leaveRequest, leaveRow, pastSchoolDate, wibToday } from "./fixtures";

const TERM_2031 = { termStart: "2031-01-06", termEnd: "2031-06-20" } as const;
const ACTIVATED = new Date("2030-12-01T00:00:00Z");

let superToken: string;
before(async () => {
  superToken = await webToken((await createSuperAdmin()).id);
});
after(disconnect);

const createHoliday = (schoolId: string, date: string) =>
  callRoute<Envelope<{ id: string }>>(createHolidayRoute, {
    method: "POST",
    url: `/api/v1/school/holidays?schoolId=${schoolId}`,
    bearer: superToken,
    json: { name: uniq("Libur"), startDate: date, endDate: date },
  });

const deleteHoliday = (schoolId: string, id: string) =>
  callRoute(deleteHolidayRoute, { method: "DELETE", url: `/api/v1/school/holidays/${id}?schoolId=${schoolId}`, bearer: superToken, params: { id } });

async function fourSources(schoolId: string, date: string) {
  const [a, b, c, d] = [
    await createStudent(schoolId, { activatedAt: ACTIVATED }),
    await createStudent(schoolId, { activatedAt: ACTIVATED }),
    await createStudent(schoolId, { activatedAt: ACTIVATED }),
    await createStudent(schoolId, { activatedAt: ACTIVATED }),
  ];
  const leave = await leaveRequest({ schoolId, studentId: b.student.id, from: date, to: date, status: "APPROVED" });
  await autoAlphaRow({ schoolId, studentId: a.student.id, date });
  await leaveRow({ schoolId, studentId: b.student.id, date, leaveRequestId: leave.id });
  await checkInRow({ schoolId, studentId: c.student.id, userId: c.user.id, date, deviceId: uniq("dev") });
  await adminRow({ schoolId, studentId: d.student.id, date });
}

const sourcesOn = async (schoolId: string, date: string) =>
  (await prisma.attendance.findMany({ where: { schoolId, date: toDbDate(date) }, select: { source: true } })).map((r) => r.source).sort();

test("libur sekolah ditambah mundur: baris AUTO_ALPHA & LEAVE dihapus, CHECKIN & ADMIN tetap, diaudit", async () => {
  const date = "2031-03-11";
  const school = await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM_2031 });
  await fourSources(school.id, date);
  const res = await createHoliday(school.id, date);
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.deepEqual(await sourcesOn(school.id, date), ["ADMIN", "CHECKIN"]);
  const audit = await prisma.auditLog.findFirst({ where: { action: "attendance.calendar_sync", schoolId: school.id } });
  assert.deepEqual((audit?.after as { deletedRows: number }).deletedRows, 2);
});

test("libur nasional ditambah: baris turunan dihapus di semua sekolah pada tanggal itu", async () => {
  const date = "2031-03-12";
  const [s1, s2] = [
    await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM_2031 }),
    await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), timezone: "WIT", ...TERM_2031 }),
  ];
  await fourSources(s1.id, date);
  const other = await createStudent(s2.id, { activatedAt: ACTIVATED });
  await autoAlphaRow({ schoolId: s2.id, studentId: other.student.id, date });
  await autoAlphaRow({ schoolId: s2.id, studentId: other.student.id, date: addDays(date, 1) });
  const holiday = await prisma.holiday.create({ data: { schoolId: null, name: uniq("Nasional"), startDate: toDbDate(date), endDate: toDbDate(date) } });
  try {
    const result = await withTx((tx) => onCalendarChanged(tx, { schoolId: null, from: date, to: date, kind: "ADDED" }, actionCtx()));
    assert.ok(result.affected >= 3, `affected=${result.affected}`);
    assert.deepEqual(await sourcesOn(s1.id, date), ["ADMIN", "CHECKIN"]);
    assert.deepEqual(await sourcesOn(s2.id, date), []);
    assert.deepEqual(await sourcesOn(s2.id, addDays(date, 1)), ["AUTO_ALPHA"], "tanggal di luar libur tidak tersentuh");
  } finally {
    await prisma.holiday.delete({ where: { id: holiday.id } });
  }
});

test("REMOVED tidak menghapus baris absensi; ADDED tidak menyentuh JobRun", async () => {
  const date = "2031-03-13";
  const school = await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM_2031 });
  const st = await createStudent(school.id, { activatedAt: ACTIVATED });
  await autoAlphaRow({ schoolId: school.id, studentId: st.student.id, date });
  const result = await withTx((tx) => onCalendarChanged(tx, { schoolId: school.id, from: date, to: date, kind: "REMOVED" }, actionCtx()));
  assert.deepEqual(result, { affected: 0 });
  assert.deepEqual(await sourcesOn(school.id, date), ["AUTO_ALPHA"]);

  const today = wibToday();
  await prisma.jobRun.create({ data: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: today, status: "SUCCEEDED", startedAt: new Date() } });
  await prisma.holiday.create({ data: { schoolId: school.id, name: uniq("Libur"), startDate: toDbDate(today), endDate: toDbDate(today) } });
  await withTx((tx) => onCalendarChanged(tx, { schoolId: school.id, from: today, to: today, kind: "ADDED" }, actionCtx()));
  assert.equal(await prisma.jobRun.count({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: today } }), 1);
});

test("libur dihapus membuka ulang hari yang sudah ditutup; tick berikutnya menutupnya lagi (ALPHA)", async () => {
  const today = wibToday();
  const date = await pastSchoolDate([2, 3, 4, 5]);
  const school = await createAttendanceSchool({
    createdAt: instantAtLocal(date, 60, "WIB"),
    termStart: addDays(today, -60),
    termEnd: addDays(today, 60),
    data: { dayEndMinute: 1439, checkInCloseMinute: 600 },
  });
  const st = await createStudent(school.id, { activatedAt: instantAtLocal(addDays(today, -90), 0, "WIB") });
  const created = await createHoliday(school.id, date);
  assert.equal(created.status, 201, JSON.stringify(created.body?.error));

  await runAutoAlpha(jobCtx(new Date(), { schoolIds: [school.id] }));
  const run = await prisma.jobRun.findFirstOrThrow({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: date } });
  assert.equal((run.result as { skipped?: string }).skipped, "NON_SCHOOL_DAY");
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id, date: toDbDate(date) } }), 0);

  const removed = await deleteHoliday(school.id, created.body!.data.id);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));
  assert.equal(await prisma.jobRun.count({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: date } }), 0, "JobRun dibuka ulang");
  assert.ok(await prisma.jobRun.count({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id } }) > 0, "hari lain tetap tertutup");

  const again = await runAutoAlpha(jobCtx(new Date(), { schoolIds: [school.id] }));
  assert.equal(again.ran, 1, "hanya hari yang dibuka ulang yang ditutup lagi");
  const row = await prisma.attendance.findFirst({ where: { studentId: st.student.id, date: toDbDate(date) } });
  assert.equal(row?.status, "ALPHA");
  assert.equal(row?.source, "AUTO_ALPHA");
});

test("libur lama (> 7 hari) ditambah lalu dihapus super admin: ALPHA & LEAVE dipulihkan langsung, JobRun tetap SUCCEEDED", async () => {
  const today = wibToday();
  const date = await pastSchoolDate([12, 13, 14, 15]);
  const school = await createAttendanceSchool({ createdAt: instantAtLocal(addDays(today, -60), 60, "WIB"), termStart: addDays(today, -60), termEnd: addDays(today, 60) });
  const activatedAt = instantAtLocal(addDays(today, -90), 0, "WIB");
  const [absent, onLeave] = [await createStudent(school.id, { activatedAt }), await createStudent(school.id, { activatedAt })];
  const leave = await leaveRequest({ schoolId: school.id, studentId: onLeave.student.id, from: date, to: date, status: "APPROVED", type: "SAKIT" });
  await autoAlphaRow({ schoolId: school.id, studentId: absent.student.id, date });
  await leaveRow({ schoolId: school.id, studentId: onLeave.student.id, date, leaveRequestId: leave.id, status: "SAKIT" });
  await prisma.jobRun.create({ data: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: date, status: "SUCCEEDED", startedAt: new Date() } });

  const created = await createHoliday(school.id, date);
  assert.equal(created.status, 201, JSON.stringify(created.body?.error));
  assert.deepEqual(await sourcesOn(school.id, date), []);
  const removed = await deleteHoliday(school.id, created.body!.data.id);
  assert.equal(removed.status, 200, JSON.stringify(removed.body));

  const rows = await prisma.attendance.findMany({ where: { schoolId: school.id, date: toDbDate(date) }, select: { studentId: true, status: true, source: true, leaveRequestId: true } });
  const byStudent = new Map(rows.map((row) => [row.studentId, row]));
  assert.deepEqual(byStudent.get(absent.student.id), { studentId: absent.student.id, status: "ALPHA", source: "AUTO_ALPHA", leaveRequestId: null });
  assert.deepEqual(byStudent.get(onLeave.student.id), { studentId: onLeave.student.id, status: "SAKIT", source: "LEAVE", leaveRequestId: leave.id });
  const run = await prisma.jobRun.findFirstOrThrow({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: date } });
  assert.equal(run.status, "SUCCEEDED");
  assert.equal((run.result as { inserted?: number }).inserted, 2);
  const audit = await prisma.auditLog.findFirst({ where: { action: "attendance.calendar_sync", schoolId: school.id, after: { path: "$.kind", equals: "REMOVED" } } });
  assert.equal((audit?.after as { reclosedDays?: number } | null)?.reclosedDays, 1);
});

test("libur nasional: DELETE per sekolah tidak menunggu baris terkunci sekolah lain di tanggal lain", async () => {
  const date = "2031-03-14";
  const [target, busy] = [
    await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM_2031 }),
    await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM_2031 }),
  ];
  const st = await createStudent(target.id, { activatedAt: ACTIVATED });
  await autoAlphaRow({ schoolId: target.id, studentId: st.student.id, date });
  const other = await createStudent(busy.id, { activatedAt: ACTIVATED });
  const lockedRow = await checkInRow({ schoolId: busy.id, studentId: other.student.id, userId: other.user.id, date: addDays(date, 3), deviceId: uniq("dev") });
  const holiday = await prisma.holiday.create({ data: { schoolId: null, name: uniq("Nasional"), startDate: toDbDate(date), endDate: toDbDate(date) } });
  const held = await holdTx((tx) => tx.$queryRaw`SELECT id FROM Attendance WHERE id = ${lockedRow.id} FOR UPDATE`);
  try {
    const sync = withTx((tx) => onCalendarChanged(tx, { schoolId: null, from: date, to: date, kind: "ADDED" }, actionCtx()), { retries: 0 });
    const outcome = await Promise.race([sync.then(() => "done"), pause(5_000).then(() => "blocked")]);
    assert.equal(outcome, "done", "DELETE libur nasional tidak boleh memindai/mengunci baris sekolah lain");
    assert.deepEqual(await sourcesOn(target.id, date), []);
  } finally {
    await held.release();
    await prisma.holiday.delete({ where: { id: holiday.id } });
  }
});
