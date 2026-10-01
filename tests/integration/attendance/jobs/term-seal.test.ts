import { after, test } from "node:test";
import assert from "node:assert/strict";
import { POST as createTermRoute } from "@/app/api/v1/school/academic-years/[id]/terms/route";
import { POST as createHolidayRoute } from "@/app/api/v1/school/holidays/route";
import { DELETE as deleteHolidayRoute } from "@/app/api/v1/school/holidays/[id]/route";
import { CLOSE_SCHOOL_SELECT, closeSchoolDay } from "@/lib/attendance/auto-alpha-job";
import { AUTO_ALPHA_JOB, isSealedClose } from "@/lib/attendance/auto-alpha-rules";
import { addDays, localParts, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { createStudent } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTenant, findAudit, type Tenant } from "../../academics/helpers";

/**
 * Semester yang baru mencakup HARI INI setelah jam tutup absen -> hari ini disegel (tanpa ALPHA). Jam tutup
 * sekolah uji diatur relatif ke jam sekarang agar deterministik: 00:02 (pasti sudah tutup) vs 23:54.
 */
after(disconnect);

const ALL_DAYS = 127;

async function tenantWithClose(closeMinute: number): Promise<Tenant> {
  return createTenant({ data: { checkInOpenMinute: 0, startMinute: 1, lateToleranceMinutes: 0, checkInCloseMinute: closeMinute, dayEndMinute: 1439, schoolDaysMask: ALL_DAYS } });
}

/** Tahun ajaran tahun kalender ini + siswa aktif sejak kemarin (wajib absen hari ini). */
async function prepare(t: Tenant, today: string): Promise<{ yearId: string; studentId: string }> {
  const year = Number(today.slice(0, 4));
  const academicYear = await prisma.academicYear.create({
    data: { schoolId: t.schoolId, name: `${year}/${year + 1}`, startDate: toDbDate(`${year}-01-01`), endDate: toDbDate(`${year}-12-31`) },
  });
  const { student } = await createStudent(t.schoolId);
  await prisma.student.update({ where: { id: student.id }, data: { activatedAt: new Date(Date.now() - 86_400_000) } });
  return { yearId: academicYear.id, studentId: student.id };
}

function termCoveringToday(today: string): { semester: string; startDate: string; endDate: string } {
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const end = addDays(today, 30) < yearEnd ? addDays(today, 30) : yearEnd;
  return { semester: "GANJIL", startDate: today, endDate: end };
}

function postTerm(t: Tenant, yearId: string, body: unknown) {
  return callRoute<Envelope<{ id: string }>>(createTermRoute, {
    method: "POST", url: `/api/v1/school/academic-years/${yearId}/terms`, bearer: t.adminToken, json: body, params: { id: yearId },
  });
}

async function closeToday(t: Tenant, today: string): Promise<void> {
  const school = await prisma.school.findUniqueOrThrow({ where: { id: t.schoolId }, select: CLOSE_SCHOOL_SELECT });
  await closeSchoolDay(school, today, { now: new Date(), requestId: "term-seal-test" });
}

const autoAlphaRun = (t: Tenant, date: string) =>
  prisma.jobRun.findUnique({ where: { job_scopeKey_runKey: { job: AUTO_ALPHA_JOB, scopeKey: t.schoolId, runKey: date } } });

test("semester dibuat setelah absen tutup -> hari ini disegel, penutupan hari tidak menulis ALPHA", async (ctx) => {
  const local = localParts(new Date(), "WIB");
  if (local.minuteOfDay < 2) return ctx.skip("berjalan tepat 00:00-00:01 WIB");
  const t = await tenantWithClose(2);
  const { yearId, studentId } = await prepare(t, local.ymd);

  const res = await postTerm(t, yearId, termCoveringToday(local.ymd));
  assert.equal(res.status, 201);
  const run = await autoAlphaRun(t, local.ymd);
  assert.equal(run?.status, "SUCCEEDED");
  assert.equal(isSealedClose(run?.result), true);
  const audit = await findAudit(res.body!.data.id, "term.create");
  assert.equal((audit?.after as { sealedAttendanceDate?: string } | null)?.sealedAttendanceDate, local.ymd);

  await closeToday(t, local.ymd);
  assert.equal(await prisma.attendance.count({ where: { studentId, date: toDbDate(local.ymd) } }), 0, "siswa tidak ditandai ALPHA");
});

test("semester dibuat saat absen masih buka -> tidak disegel, hari ini tetap ditutup normal", async (ctx) => {
  const local = localParts(new Date(), "WIB");
  if (local.minuteOfDay >= 1434) return ctx.skip("berjalan setelah 23:54 WIB");
  const t = await tenantWithClose(1434);
  const { yearId, studentId } = await prepare(t, local.ymd);

  assert.equal((await postTerm(t, yearId, termCoveringToday(local.ymd))).status, 201);
  assert.equal(await autoAlphaRun(t, local.ymd), null);

  await closeToday(t, local.ymd);
  const row = await prisma.attendance.findFirst({ where: { studentId, date: toDbDate(local.ymd) }, select: { status: true, source: true } });
  assert.deepEqual(row, { status: "ALPHA", source: "AUTO_ALPHA" });
});

test("segel bertahan saat libur hari ini ditambah lalu dihapus (calendar-sync tidak membuka ulang hari tersegel)", async (ctx) => {
  const local = localParts(new Date(), "WIB");
  if (local.minuteOfDay < 2) return ctx.skip("berjalan tepat 00:00-00:01 WIB");
  const t = await tenantWithClose(2);
  const { yearId, studentId } = await prepare(t, local.ymd);
  assert.equal((await postTerm(t, yearId, termCoveringToday(local.ymd))).status, 201);

  const holiday = await callRoute<Envelope<{ id: string }>>(createHolidayRoute, { method: "POST", url: "/api/v1/school/holidays", bearer: t.adminToken, json: { name: "Libur mendadak", startDate: local.ymd, endDate: local.ymd } });
  assert.equal(holiday.status, 201);
  const id = holiday.body!.data.id;
  assert.equal((await callRoute(deleteHolidayRoute, { method: "DELETE", url: `/api/v1/school/holidays/${id}`, bearer: t.adminToken, params: { id } })).status, 200);

  assert.equal(isSealedClose((await autoAlphaRun(t, local.ymd))?.result), true, "JobRun tersegel tidak dihapus");
  await closeToday(t, local.ymd);
  assert.equal(await prisma.attendance.count({ where: { studentId, date: toDbDate(local.ymd) } }), 0);
});
