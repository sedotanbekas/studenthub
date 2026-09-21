import type { ActionContext } from "@/lib/auth/principal";
import { removeFutureDerivedAttendance } from "@/lib/attendance/student-hooks";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { voidFutureInvoicesForStudent } from "@/lib/billing/student-hooks";
import { prisma, type Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import type { SchoolScope } from "@/lib/tenant/scope";
import { localParts } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { getActivationGaps } from "./activation-rules";
import type { StudentStatusValue } from "./constants";
import { activationInputOf } from "./dto";
import { activationIncomplete, studentStateChanged, withStudentConflicts } from "./guards";
import { claimNisn, type ReleasedHolder } from "./nisn-claim";
import { recordNisnReleases } from "./nisn-release-log";
import { loadStudentDetail } from "./queries";
import {
  findStudentRow,
  loadSchoolContext,
  lockForStudentWrite,
  lockStudentRow,
  readClassHint,
  scopeFor,
  type SchoolContext,
  type StudentRow,
} from "./records";
import type { ActivateStudentInput, ChangeStatusInput, StudentDetail } from "./schemas";
import { planTransition, type TransitionEffects } from "./status-rules";

/**
 * Transisi status siswa lewat SATU tabel murni (status-rules). Setiap jalur ke ACTIVE: data wajib
 * lengkap + klaim NISN + activatedAt diisi bila kosong. User.isActive selalu diselaraskan; INACTIVE &
 * MOVED mencabut sesi; MOVED melepas NISN dan memanggil kait billing void tagihan masa depan. Keluar dari
 * ACTIVE: baris absensi izin mendatang dihapus (kait absensi, di bawah kunci attendance:<studentId>).
 *
 * Urutan transaksi: kunci aplikasi (kelas siswa + kuota pelepasan NISN hanya ke ACTIVE; absensi siswa hanya
 * ke non-ACTIVE) -> Student FOR UPDATE -> BARU membaca sekolah & siswa -> tulis compare-and-set pada status
 * yang dibaca.
 */
export interface StatusChangeResult {
  readonly student: StudentDetail;
  readonly nisnReleased: boolean;
  readonly revokedSessions: number;
  readonly voidedInvoiceIds: string[];
}

type Outcome = Omit<StatusChangeResult, "student">;

export interface StatusChangeRequest {
  readonly scope: SchoolScope;
  readonly id: string;
  readonly input: ChangeStatusInput;
  /** currentClassId yang dibaca SEBELUM transaksi (kunci kelas); dicek ulang di bawah kunci. */
  readonly classHint: string | null;
}

function invalidTransition(from: StudentStatusValue, to: StudentStatusValue) {
  const label = ENUM_LABELS.StudentStatus;
  return conflict("INVALID_STATUS_TRANSITION", `Status siswa ${label[from]} tidak dapat diubah menjadi ${label[to]}.`, { from, to });
}

function nextNisn(plan: TransitionEffects, row: StudentRow): { activeNisn?: string | null } {
  if (plan.nisn === "CLAIM") return { activeNisn: row.nisn };
  if (plan.nisn === "RELEASE") return { activeNisn: null };
  return {};
}

function assertComplete(row: StudentRow, school: SchoolContext, now: Date): void {
  const gaps = getActivationGaps(activationInputOf(row, school), now);
  if (gaps.length > 0) throw activationIncomplete(gaps);
}

async function persistTransition(tx: Tx, scope: SchoolScope, row: StudentRow, to: StudentStatusValue, plan: TransitionEffects, now: Date): Promise<void> {
  const updated = await tx.student.updateMany({
    where: { id: row.id, schoolId: scope.schoolId, status: row.status },
    data: { status: to, ...nextNisn(plan, row), ...(to === "ACTIVE" && row.activatedAt === null ? { activatedAt: now } : {}) },
  });
  if (updated.count !== 1) throw studentStateChanged();
  await tx.user.update({ where: { id: row.userId }, data: { isActive: plan.userActive } });
}

/** Kunci dulu, baru baca (lihat komentar modul). */
async function lockAndRead(tx: Tx, request: StatusChangeRequest): Promise<{ school: SchoolContext; row: StudentRow }> {
  const activating = request.input.to === "ACTIVE";
  await lockForStudentWrite(tx, {
    classIds: activating ? [request.classHint] : [],
    claimingSchoolId: activating ? request.scope.schoolId : null,
    attendanceStudentId: activating ? null : request.id,
  });
  await lockStudentRow(tx, request.scope, request.id);
  const school = await loadSchoolContext(tx, request.scope);
  const row = await findStudentRow(tx, request.scope, request.id);
  // Kelas berubah sejak dibaca sebelum transaksi: kunci kelas yang diambil bukan kelas siswa lagi.
  if (activating && row.currentClassId !== request.classHint) throw studentStateChanged();
  return { school, row };
}

async function sideEffects(tx: Tx, request: StatusChangeRequest, row: StudentRow, school: SchoolContext, plan: TransitionEffects, ctx: ActionContext) {
  const revokedSessions = plan.revokeSessions ? await revokeAllSessions(tx, row.userId, "ACCOUNT_DISABLED", ctx.now) : 0;
  const voidedInvoiceIds = plan.voidFutureInvoices
    ? await voidFutureInvoicesForStudent(
        tx,
        { schoolId: request.scope.schoolId, studentId: row.id, todayLocal: localParts(ctx.now, school.timezone).ymd, reason: request.input.reason ?? "Siswa pindah" },
        ctx,
      )
    : [];
  return { revokedSessions, voidedInvoiceIds };
}

/** Keluar dari ACTIVE: baris absensi turunan (izin) mendatang dihapus (lihat attendance/student-hooks.ts). */
async function dropFutureAttendance(tx: Tx, request: StatusChangeRequest, row: StudentRow, school: SchoolContext, now: Date): Promise<number> {
  if (row.status !== "ACTIVE" || request.input.to === "ACTIVE") return 0;
  return removeFutureDerivedAttendance(tx, { schoolId: request.scope.schoolId, studentId: row.id, todayLocal: localParts(now, school.timezone).ymd });
}

type AuditEffects = Omit<Outcome, "nisnReleased"> & { readonly futureAttendanceRemoved: number };

function statusAudit(request: StatusChangeRequest, row: StudentRow, plan: TransitionEffects, released: ReleasedHolder | null, effects: AuditEffects) {
  return {
    action: "student.status_change",
    entityType: "Student",
    entityId: row.id,
    schoolId: request.scope.schoolId,
    before: { status: row.status, userActive: row.user.isActive, hasActiveNisn: row.activeNisn !== null },
    after: { status: request.input.to, userActive: plan.userActive, reason: request.input.reason ?? null, nisnReleased: released !== null, ...effects },
  };
}

/** Transisi status di dalam transaksi (diekspor untuk komposisi & test isolasi). */
export async function applyStatusChange(tx: Tx, request: StatusChangeRequest, ctx: ActionContext): Promise<Outcome> {
  const { school, row } = await lockAndRead(tx, request);
  const plan = planTransition(row.status, request.input.to);
  if (plan === null) throw invalidTransition(row.status, request.input.to);
  if (plan.requireComplete) assertComplete(row, school, ctx.now);
  const policy = { confirmRelease: request.input.confirmReleaseGraduatedNisn, claimer: school };
  const released = plan.nisn === "CLAIM" ? await claimNisn(tx, { studentId: row.id, nisn: row.nisn }, ctx, policy) : null;
  await persistTransition(tx, request.scope, row, request.input.to, plan, ctx.now);
  const effects = await sideEffects(tx, request, row, school, plan, ctx);
  const futureAttendanceRemoved = await dropFutureAttendance(tx, request, row, school, ctx.now);
  await recordNisnReleases(tx, released ? [released] : [], school, ctx);
  await writeAudit(tx, statusAudit(request, row, plan, released, { ...effects, futureAttendanceRemoved }), ctx);
  return { nisnReleased: released !== null, ...effects };
}

export async function changeStudentStatus(
  ctx: ActionContext,
  schoolId: string | undefined,
  id: string,
  input: ChangeStatusInput,
): Promise<StatusChangeResult> {
  const scope = scopeFor(ctx, schoolId);
  const classHint = input.to === "ACTIVE" ? await readClassHint(prisma, scope, id) : null;
  const request: StatusChangeRequest = { scope, id, input, classHint };
  const outcome = await withStudentConflicts(() => withTx((tx) => applyStatusChange(tx, request, ctx)));
  return { student: await loadStudentDetail(scope, id, ctx.now), ...outcome };
}

/** POST /school/students/{id}/activate = transisi ke ACTIVE (DRAFT/INACTIVE/GRADUATED/MOVED). */
export async function activateStudent(
  ctx: ActionContext,
  schoolId: string | undefined,
  id: string,
  input: ActivateStudentInput,
): Promise<StatusChangeResult> {
  return changeStudentStatus(ctx, schoolId, id, { to: "ACTIVE", confirmReleaseGraduatedNisn: input.confirmReleaseGraduatedNisn });
}
