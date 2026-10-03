import type { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { attendanceLockKey } from "@/lib/lock-keys";
import { notifyStudents } from "@/lib/notifications/notify";
import { attendanceCorrectedNotification } from "@/lib/notifications/templates/attendance-admin";
import { lockStudentRow } from "@/lib/students/records";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate } from "@/lib/time/zone";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import { parseFlags } from "./anomaly-rules";
import { FLAGS_CHANGED, needsAnomalyReview, normalizeReviewNote, planAnomalyReview, reviewViolationStatus, sameFlagSet } from "./anomaly-review-rules";
import type { AnomalyReviewBody, AnomalyReviewResultDto } from "./anomaly-review-schemas";
import { buildCorrectionPatch, type CorrectionPlan } from "./correction-rules";
import { assertCorrectableDate } from "./correction-service";
import { toReviewDto } from "./monitor-dto";

/**
 * Tinjau anomali (B1, keputusan pemilik 2026-10-03): VALID = absensi tetap; INVALID = jalur koreksi menjadi ALPHA
 * (sumber ADMIN, catatan = alasan, jendela 45 hari admin sekolah, bukti tetap) + notifikasi ATTENDANCE_CORRECTED.
 * Urutan kunci: AppLock attendance:<studentId> -> Student FOR UPDATE -> Attendance FOR UPDATE -> tulis -> AuditLog &
 * Notification TERAKHIR. Satu audit attendance.anomaly_review (tanpa attendance.correct terpisah).
 */
const REVIEW_SELECT = {
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
  anomalyFlags: true,
  updatedAt: true,
  anomalyReviewDecision: true,
  anomalyReviewedAt: true,
  anomalyReviewNote: true,
  anomalyReviewedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.AttendanceSelect;

type ReviewRow = Prisma.AttendanceGetPayload<{ select: typeof REVIEW_SELECT }>;

interface ReviewRequest {
  readonly scope: SchoolScope;
  readonly id: string;
  readonly studentId: string;
  readonly body: AnomalyReviewBody;
  readonly windowLimited: boolean;
}

const recordNotFound = () => notFound("Catatan absensi tidak ditemukan.");

function toResultAttendance(row: ReviewRow): AnomalyReviewResultDto["attendance"] {
  const { anomalyFlags: _flags, anomalyReviewDecision: _d, anomalyReviewedAt, anomalyReviewNote: _n, anomalyReviewedBy: _b, ...base } = row;
  return {
    ...base,
    date: fromDbDate(row.date),
    checkInAt: row.checkInAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    needsReview: needsAnomalyReview({ hasAnomaly: row.hasAnomaly, anomalyReviewedAt }),
    review: toReviewDto(row),
  };
}

async function readLocked(tx: Tx, request: ReviewRequest): Promise<ReviewRow> {
  await lockKey(tx, attendanceLockKey(request.studentId));
  await lockStudentRow(tx, request.scope, request.studentId);
  await lockRows(tx, "Attendance", [request.id]);
  const row = await tx.attendance.findFirst({ where: { id: request.id, schoolId: request.scope.schoolId }, select: REVIEW_SELECT });
  if (!row) throw recordNotFound();
  return row;
}

/** Rencana koreksi ALPHA untuk INVALID (null untuk VALID); tanggal dicek seperti Koreksi absensi. */
async function invalidPatch(tx: Tx, request: ReviewRequest, row: ReviewRow, now: Date): Promise<CorrectionPlan | null> {
  if (request.body.decision !== "INVALID") return null;
  await assertCorrectableDate(tx, { scope: request.scope, date: fromDbDate(row.date), windowLimited: request.windowLimited }, now);
  const snapshot = { status: row.status, source: row.source, lateMinutes: row.lateMinutes, note: row.note };
  const plan = buildCorrectionPatch(snapshot, { status: "ALPHA", lateMinutes: null, reason: normalizeReviewNote(request.body.note) ?? "" });
  if (plan.kind === "create") throw new Error("Rencana tinjau anomali tidak konsisten");
  return plan;
}

async function recordReview(tx: Tx, request: ReviewRequest, before: ReviewRow, after: ReviewRow, ctx: ActionContext): Promise<void> {
  const date = fromDbDate(before.date);
  const snapshot = (row: ReviewRow) => ({ decision: row.anomalyReviewDecision, note: row.anomalyReviewNote, status: row.status, source: row.source, lateMinutes: row.lateMinutes });
  await writeAudit(
    tx,
    {
      action: "attendance.anomaly_review",
      entityType: "Attendance",
      entityId: before.id,
      schoolId: request.scope.schoolId,
      before: snapshot(before),
      after: { ...snapshot(after), flags: parseFlags(before.anomalyFlags), date, studentId: before.studentId },
    },
    ctx,
  );
}

async function applyReview(tx: Tx, request: ReviewRequest, ctx: ActionContext): Promise<AnomalyReviewResultDto> {
  const row = await readLocked(tx, request);
  const plan = planAnomalyReview({ hasAnomaly: row.hasAnomaly, decision: row.anomalyReviewDecision }, request.body.decision);
  if (plan.kind === "violation") throw violationError(plan.violation.code, plan.violation.message);
  if (plan.kind === "unchanged") return { attendance: toResultAttendance(row), unchanged: true, statusChanged: false };
  if (!sameFlagSet(parseFlags(row.anomalyFlags), request.body.flags)) throw conflict(FLAGS_CHANGED.code, FLAGS_CHANGED.message);
  const patch = await invalidPatch(tx, request, row, ctx.now);
  const statusChanged = patch?.kind === "update";
  const data = {
    anomalyReviewDecision: request.body.decision,
    anomalyReviewedAt: ctx.now,
    anomalyReviewedById: requirePrincipal(ctx).userId,
    anomalyReviewNote: normalizeReviewNote(request.body.note),
    ...(patch?.kind === "update" ? patch.data : {}),
  };
  const { count } = await tx.attendance.updateMany({ where: { id: row.id, schoolId: request.scope.schoolId }, data });
  if (count !== 1) throw conflict("CONFLICT_RETRY", "Absensi berubah bersamaan. Silakan ulangi.");
  const updated = await tx.attendance.findFirst({ where: { id: row.id, schoolId: request.scope.schoolId }, select: REVIEW_SELECT });
  if (!updated) throw recordNotFound();
  await recordReview(tx, request, row, updated, ctx);
  if (statusChanged) await notifyInvalid(tx, request, updated, ctx);
  return { attendance: toResultAttendance(updated), unchanged: false, statusChanged };
}

function violationError(code: string, message: string) {
  return reviewViolationStatus(code) === 409 ? conflict(code, message) : unprocessable(code, message);
}

async function notifyInvalid(tx: Tx, request: ReviewRequest, row: ReviewRow, ctx: ActionContext): Promise<void> {
  const event = attendanceCorrectedNotification({
    attendanceId: row.id,
    date: fromDbDate(row.date),
    status: "ALPHA",
    lateMinutes: null,
    reason: normalizeReviewNote(request.body.note) ?? "",
    actorRole: requirePrincipal(ctx).role,
  });
  await notifyStudents(tx, [row.studentId], event, ctx);
}

/**
 * POST /school/attendance/{id}/anomaly-review. Catatan di luar cakupan -> 404 (dicek sebelum transaksi agar kunci
 * aplikasi tidak dibuat untuk id sembarang, lalu dibaca ulang di bawah kunci).
 */
export async function reviewAnomaly(ctx: ActionContext, schoolId: string | undefined, id: string, body: AnomalyReviewBody): Promise<AnomalyReviewResultDto> {
  const principal = requirePrincipal(ctx);
  const scope = resolveSchoolScope(principal, schoolId);
  const pre = await prisma.attendance.findFirst({ where: { id, schoolId: scope.schoolId }, select: { studentId: true } });
  if (!pre) throw recordNotFound();
  const request: ReviewRequest = { scope, id, studentId: pre.studentId, body, windowLimited: principal.role !== "SUPER_ADMIN" };
  return withTx((tx) => applyReview(tx, request, ctx));
}
