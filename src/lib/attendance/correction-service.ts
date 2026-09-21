import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { checkSchoolDay } from "@/lib/calendar/rules";
import { prisma, type Prisma, type Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { notifyStudents } from "@/lib/notifications/notify";
import { attendanceCorrectedNotification } from "@/lib/notifications/templates/attendance-admin";
import { attendanceLockKey } from "@/lib/lock-keys";
import { lockStudentRow } from "@/lib/students/records";
import { uniqueIndexOf } from "@/lib/students/unique-error";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { lockKey, withTx } from "@/lib/tx";
import type { CorrectedAttendanceDto, CorrectionBody, CorrectionResultDto } from "./admin-schemas";
import { buildCorrectionPatch, validateCorrection, type CorrectionPlan } from "./correction-rules";

/**
 * Koreksi manual absensi oleh admin (desain 02 §3.9, D22): upsert per (siswa, tanggal).
 * Urutan transaksi: kunci aplikasi `attendance:<studentId>` -> Student FOR UPDATE -> baca sekolah,
 * kalender, baris absensi -> tulis (compare-and-set) -> AuditLog & Notification TERAKHIR.
 */

/** INSERT yang kalah balapan dengan auto-ALPHA/check-in (P2002) diulang sekali: baris kini ada -> jalur update. */
const MAX_UNIQUE_RETRIES = 1;

const ATTENDANCE_SELECT = {
  id: true,
  studentId: true,
  classId: true,
  date: true,
  status: true,
  source: true,
  lateMinutes: true,
  checkInAt: true,
  note: true,
  leaveRequestId: true,
  hasAnomaly: true,
  updatedAt: true,
} as const satisfies Prisma.AttendanceSelect;

type AttendanceRow = Prisma.AttendanceGetPayload<{ select: typeof ATTENDANCE_SELECT }>;

interface CorrectionRequest {
  readonly scope: SchoolScope;
  readonly studentId: string;
  readonly date: LocalDate;
  readonly body: CorrectionBody;
  readonly windowLimited: boolean;
}

function toDto(row: AttendanceRow): CorrectedAttendanceDto {
  return { ...row, date: fromDbDate(row.date), checkInAt: row.checkInAt?.toISOString() ?? null, updatedAt: row.updatedAt.toISOString() };
}

const studentNotFound = () => notFound("Siswa tidak ditemukan.");

/** Validasi tanggal: masa depan / bukan hari sekolah / di luar jendela 45 hari (admin sekolah) -> 422. */
async function assertCorrectableDate(tx: Tx, request: CorrectionRequest, now: Date): Promise<void> {
  const school = await tx.school.findUnique({ where: { id: request.scope.schoolId }, select: { id: true, timezone: true, schoolDaysMask: true } });
  if (!school) throw studentNotFound();
  const calendar = await loadCalendarContext(tx, school, { from: request.date, to: request.date });
  const violation = validateCorrection({
    date: request.date,
    today: localParts(now, school.timezone).ymd,
    isSchoolDay: checkSchoolDay(request.date, calendar).isSchoolDay,
    windowLimited: request.windowLimited,
  });
  if (violation) throw unprocessable(violation.code, violation.message);
}

async function writeCorrection(tx: Tx, request: CorrectionRequest, existing: AttendanceRow | null, plan: CorrectionPlan, classId: string | null): Promise<AttendanceRow> {
  const { scope, studentId, date } = request;
  if (plan.kind === "create") {
    return tx.attendance.create({
      data: { schoolId: scope.schoolId, studentId, classId, date: toDbDate(date), ...plan.after },
      select: ATTENDANCE_SELECT,
    });
  }
  if (plan.kind !== "update" || existing === null) throw new Error("Rencana koreksi tidak konsisten");
  const { count } = await tx.attendance.updateMany({
    where: { id: existing.id, schoolId: scope.schoolId, status: existing.status, source: existing.source },
    data: plan.data,
  });
  if (count !== 1) throw conflict("CONFLICT_RETRY", "Absensi berubah bersamaan. Silakan ulangi.");
  const row = await tx.attendance.findFirst({ where: { id: existing.id, schoolId: scope.schoolId }, select: ATTENDANCE_SELECT });
  if (!row) throw conflict("CONFLICT_RETRY", "Absensi berubah bersamaan. Silakan ulangi.");
  return row;
}

async function recordCorrection(tx: Tx, request: CorrectionRequest, row: AttendanceRow, plan: CorrectionPlan, ctx: ActionContext): Promise<void> {
  if (plan.kind === "noop") return;
  await writeAudit(
    tx,
    {
      action: "attendance.correct",
      entityType: "Attendance",
      entityId: row.id,
      schoolId: request.scope.schoolId,
      before: plan.before ? { ...plan.before, date: request.date, studentId: request.studentId } : null,
      after: { ...plan.after, date: request.date, studentId: request.studentId },
    },
    ctx,
  );
  const event = attendanceCorrectedNotification({
    attendanceId: row.id, date: request.date, status: row.status, lateMinutes: row.lateMinutes, reason: request.body.reason, actorRole: requirePrincipal(ctx).role,
  });
  await notifyStudents(tx, [request.studentId], event, ctx);
}

async function applyCorrection(tx: Tx, request: CorrectionRequest, ctx: ActionContext): Promise<CorrectionResultDto> {
  await lockKey(tx, attendanceLockKey(request.studentId));
  await lockStudentRow(tx, request.scope, request.studentId);
  const student = await tx.student.findFirst({ where: { id: request.studentId, schoolId: request.scope.schoolId }, select: { currentClassId: true } });
  if (!student) throw studentNotFound();
  await assertCorrectableDate(tx, request, ctx.now);
  const existing = await tx.attendance.findFirst({
    where: { studentId: request.studentId, schoolId: request.scope.schoolId, date: toDbDate(request.date) },
    select: ATTENDANCE_SELECT,
  });
  const snapshot = existing && { status: existing.status, source: existing.source, lateMinutes: existing.lateMinutes, note: existing.note };
  const plan = buildCorrectionPatch(snapshot, { status: request.body.status, lateMinutes: request.body.lateMinutes ?? null, reason: request.body.reason });
  if (plan.kind === "noop" && existing) return { attendance: toDto(existing), unchanged: true };
  const row = await writeCorrection(tx, request, existing, plan, student.currentClassId);
  await recordCorrection(tx, request, row, plan, ctx);
  return { attendance: toDto(row), unchanged: false };
}

async function withUniqueRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= MAX_UNIQUE_RETRIES || uniqueIndexOf(error) === null) throw error;
    }
  }
}

/**
 * PUT /school/attendance/students/{studentId}/days/{date}. Siswa di luar cakupan -> 404 (dicek sebelum
 * transaksi agar kunci aplikasi tidak dibuat untuk id sembarang, lalu dicek ulang di bawah kunci).
 */
export async function correctAttendance(
  ctx: ActionContext,
  schoolId: string | undefined,
  key: { readonly studentId: string; readonly date: LocalDate },
  body: CorrectionBody,
): Promise<CorrectionResultDto> {
  const principal = requirePrincipal(ctx);
  const scope = resolveSchoolScope(principal, schoolId);
  const exists = await prisma.student.findFirst({ where: { id: key.studentId, schoolId: scope.schoolId }, select: { id: true } });
  if (!exists) throw studentNotFound();
  const request: CorrectionRequest = { scope, ...key, body, windowLimited: principal.role !== "SUPER_ADMIN" };
  return withUniqueRetry(() => withTx((tx) => applyCorrection(tx, request, ctx)));
}
