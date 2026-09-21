/**
 * Baris LEAVE mendatang (materialisasi D10) mengikuti perubahan siswa: keluar dari ACTIVE (MOVED/INACTIVE/
 * GRADUATED) -> dihapus (analitik & rekap tidak menghitung siswa yang sudah pergi); pindah kelas -> snapshot
 * kelas baris mendatang ikut kelas baru. Baris hari ini/lampau tidak disentuh; izin tetap APPROVED.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { PATCH as patchStudentRoute } from "@/app/api/v1/school/students/[id]/route";
import { POST as statusRoute } from "@/app/api/v1/school/students/[id]/status/route";
import { POST as onBehalfRoute } from "@/app/api/v1/school/leave-requests/route";
import { getRecap } from "@/lib/attendance/monitoring-queries";
import { makePrincipal } from "@/lib/auth/test-principal";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { addDays, toDbDate, type LocalDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createClass } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import {
  callMultipart,
  createLeaveSchool,
  createStudentWithToken,
  freeRun,
  leaveForm,
  leaveUrl,
  seedAttendance,
  todayWib,
  useInlineDefer,
  type LeaveSchoolFixture,
  type StudentWithToken,
} from "./helpers";

let restoreDefer: () => void = () => undefined;
let fx: LeaveSchoolFixture;

before(async () => {
  restoreDefer = useInlineDefer();
  fx = await createLeaveSchool();
});
beforeEach(() => resetAllLimiters());
after(async () => {
  restoreDefer();
  await disconnect();
});

async function approvedFutureLeave(st: StudentWithToken): Promise<{ startDate: LocalDate; endDate: LocalDate }> {
  const range = await freeRun(3, 3);
  const res = await callMultipart(onBehalfRoute, { url: leaveUrl(""), form: leaveForm({ ...range, studentId: st.student.id }), bearer: fx.adminToken });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return range;
}

const futureRows = (studentId: string) =>
  prisma.attendance.findMany({ where: { studentId, date: { gt: toDbDate(todayWib()) } }, select: { classId: true, source: true }, orderBy: { date: "asc" } });

const adminCtx = () => ({ principal: makePrincipal({ userId: fx.admin.id, role: "SCHOOL_ADMIN", schoolId: fx.school.id }), now: new Date(), requestId: uniq("req"), ip: null, userAgent: null, defer: () => undefined });

test("siswa PINDAH: baris izin mendatang dihapus (rekap tidak menghitung), baris lampau tetap, izin tetap APPROVED, diaudit", async () => {
  const st = await createStudentWithToken(fx);
  const range = await approvedFutureLeave(st);
  const past = await seedAttendance(fx, st, { date: addDays(todayWib(), -2), source: "ADMIN", status: "SAKIT" });
  assert.equal((await futureRows(st.student.id)).length, 3);
  assert.equal((await getRecap(adminCtx(), { date: range.startDate })).totals.izin, 1);

  const res = await callRoute<Envelope<unknown>>(statusRoute, {
    method: "POST", url: `/api/v1/school/students/${st.student.id}/status`, params: { id: st.student.id }, bearer: fx.adminToken, json: { to: "MOVED", reason: "Pindah ke sekolah lain" },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(await futureRows(st.student.id), []);
  assert.equal((await getRecap(adminCtx(), { date: range.startDate })).totals.izin, 0, "siswa yang sudah pindah tidak terhitung");
  assert.equal(await prisma.attendance.count({ where: { id: past } }), 1, "baris lampau dipertahankan");
  assert.equal((await prisma.leaveRequest.findFirstOrThrow({ where: { studentId: st.student.id } })).status, "APPROVED");
  const audit = await prisma.auditLog.findFirst({ where: { action: "student.status_change", entityId: st.student.id } });
  assert.equal((audit?.after as { futureAttendanceRemoved?: number } | null)?.futureAttendanceRemoved, 3);
});

test("siswa pindah kelas: snapshot kelas baris izin mendatang ikut kelas baru", async () => {
  const st = await createStudentWithToken(fx);
  await approvedFutureLeave(st);
  assert.deepEqual([...new Set((await futureRows(st.student.id)).map((row) => row.classId))], [fx.klass.id]);
  const target = await createClass(fx.school.id, fx.klass.academicYearId, { name: uniq("IX") });
  const res = await callRoute<Envelope<unknown>>(patchStudentRoute, {
    method: "PATCH", url: `/api/v1/school/students/${st.student.id}`, params: { id: st.student.id }, bearer: fx.adminToken, json: { currentClassId: target.id },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const rows = await futureRows(st.student.id);
  assert.equal(rows.length, 3);
  assert.deepEqual([...new Set(rows.map((row) => row.classId))], [target.id]);
  const audit = await prisma.auditLog.findFirst({ where: { action: "student.update", entityId: st.student.id } });
  assert.equal((audit?.after as { futureLeaveRowsMoved?: number } | null)?.futureLeaveRowsMoved, 3);
});
