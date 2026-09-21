/**
 * Tutup-ulang manual satu hari sekolah oleh super admin (POST /api/v1/platform/attendance/close-day):
 * memulihkan ALPHA/LEAVE hari lampau di luar jendela lookback tick, idempoten, JobRun + audit.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as recloseRoute } from "@/app/api/v1/platform/attendance/close-day/route";
import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { addDays, instantAtLocal, toDbDate } from "@/lib/time/zone";
import { webToken } from "../../academics/helpers";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createSchoolAdmin, createStudent, createSuperAdmin } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { checkInRow, createAttendanceSchool, leaveRequest, pastSchoolDate, wibToday } from "./fixtures";

interface Reclose {
  schoolId: string;
  date: string;
  isSchoolDay: boolean;
  skippedReason: string | null;
  planned: number;
  inserted: number;
  alphaPlanned: number;
  leavePlanned: number;
  anomaliesSwept: number;
}

const URL = "/api/v1/platform/attendance/close-day";
let superToken: string;
before(async () => {
  superToken = await webToken((await createSuperAdmin()).id);
});
after(disconnect);

const reclose = (json: unknown, token = superToken) => callRoute<Envelope<Reclose>>(recloseRoute, { method: "POST", url: URL, bearer: token, json });

async function pastSchool() {
  const today = wibToday();
  return createAttendanceSchool({ createdAt: instantAtLocal(addDays(today, -60), 60, "WIB"), termStart: addDays(today, -60), termEnd: addDays(today, 60) });
}

test("super admin menutup ulang hari lampau: ALPHA + LEAVE ditulis, catatan lain tetap; idempoten; JobRun & audit", async () => {
  const today = wibToday();
  const date = await pastSchoolDate([20, 21, 22, 23]);
  const school = await pastSchool();
  const activatedAt = instantAtLocal(addDays(today, -90), 0, "WIB");
  const [absent, onLeave, present] = [await createStudent(school.id, { activatedAt }), await createStudent(school.id, { activatedAt }), await createStudent(school.id, { activatedAt })];
  const leave = await leaveRequest({ schoolId: school.id, studentId: onLeave.student.id, from: date, to: date, status: "APPROVED", type: "SAKIT" });
  await checkInRow({ schoolId: school.id, studentId: present.student.id, userId: present.user.id, date, deviceId: uniq("dev") });

  const res = await reclose({ schoolId: school.id, date });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data, { schoolId: school.id, date, isSchoolDay: true, skippedReason: null, planned: 2, inserted: 2, alphaPlanned: 1, leavePlanned: 1, anomaliesSwept: 0 });
  const rows = await prisma.attendance.findMany({ where: { schoolId: school.id, date: toDbDate(date) }, select: { studentId: true, status: true, source: true, leaveRequestId: true } });
  const byStudent = new Map(rows.map((row) => [row.studentId, row]));
  assert.equal(byStudent.get(absent.student.id)?.source, "AUTO_ALPHA");
  assert.deepEqual(byStudent.get(onLeave.student.id), { studentId: onLeave.student.id, status: "SAKIT", source: "LEAVE", leaveRequestId: leave.id });
  assert.equal(byStudent.get(present.student.id)?.source, "CHECKIN");
  const run = await prisma.jobRun.findFirstOrThrow({ where: { job: AUTO_ALPHA_JOB, scopeKey: school.id, runKey: date } });
  assert.equal(run.status, "SUCCEEDED");
  assert.ok(await prisma.auditLog.findFirst({ where: { action: "attendance.reclose_day", entityId: school.id } }));

  const again = await reclose({ schoolId: school.id, date });
  assert.equal(again.body?.data.inserted, 0, "idempoten");
});

test("hari libur -> isSchoolDay false tanpa baris; tanggal belum ditutup / sebelum sekolah terdaftar -> 422; sekolah tak dikenal 404", async () => {
  const today = wibToday();
  const date = await pastSchoolDate([24, 25, 26, 27]);
  const school = await pastSchool();
  await createStudent(school.id, { activatedAt: instantAtLocal(addDays(today, -90), 0, "WIB") });
  await prisma.holiday.create({ data: { schoolId: school.id, name: uniq("Libur"), startDate: toDbDate(date), endDate: toDbDate(date) } });
  const holiday = await reclose({ schoolId: school.id, date });
  assert.equal(holiday.status, 200);
  assert.equal(holiday.body?.data.isSchoolDay, false);
  assert.equal(holiday.body?.data.skippedReason, "HOLIDAY");
  assert.equal(await prisma.attendance.count({ where: { schoolId: school.id, date: toDbDate(date) } }), 0);

  const future = await reclose({ schoolId: school.id, date: addDays(today, 1) });
  assert.equal(future.status, 422);
  assert.equal(future.body?.error?.code, "DAY_NOT_CLOSED");
  const early = await reclose({ schoolId: school.id, date: addDays(today, -61) });
  assert.equal(early.body?.error?.code, "DATE_BEFORE_SCHOOL_START");
  assert.equal((await reclose({ schoolId: uniq("tidak-ada"), date })).status, 404);
  assert.equal((await reclose({ schoolId: school.id, date: "2026-02-30" })).status, 400);
});

test("hanya super admin: admin sekolah -> 403", async () => {
  const school = await pastSchool();
  const admin = await createSchoolAdmin(school.id);
  const res = await reclose({ schoolId: school.id, date: addDays(wibToday(), -20) }, await webToken(admin.id));
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "FORBIDDEN");
});
