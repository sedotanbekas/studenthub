import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { voidFutureInvoicesForStudent } from "@/lib/billing/student-hooks";
import type { Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import type { SchoolScope } from "@/lib/tenant/scope";
import { localParts } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { getActivationGaps } from "./activation-rules";
import type { StudentStatusValue } from "./constants";
import { activationInputOf } from "./dto";
import { activationIncomplete, withStudentConflicts } from "./guards";
import { claimNisn, recordNisnReleases } from "./nisn-claim";
import { loadStudentDetail } from "./queries";
import { findStudentRow, loadSchoolContext, lockStudentRow, scopeFor, type SchoolContext, type StudentRow } from "./records";
import type { ChangeStatusInput, StudentDetail } from "./schemas";
import { planTransition, type TransitionEffects } from "./status-rules";

/**
 * Transisi status siswa lewat SATU tabel murni (status-rules). Setiap jalur ke ACTIVE: data wajib
 * lengkap + klaim NISN + activatedAt diisi bila kosong. User.isActive selalu diselaraskan; INACTIVE &
 * MOVED mencabut sesi; MOVED melepas NISN dan memanggil kait billing void tagihan masa depan.
 */
export interface StatusChangeResult {
  readonly student: StudentDetail;
  readonly nisnReleased: boolean;
  readonly revokedSessions: number;
  readonly voidedInvoiceIds: string[];
}

type Outcome = Omit<StatusChangeResult, "student">;

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
  if (updated.count !== 1) throw conflict("STUDENT_STATE_CHANGED", "Data siswa berubah bersamaan. Silakan muat ulang.");
  await tx.user.update({ where: { id: row.userId }, data: { isActive: plan.userActive } });
}

async function applyStatusChange(tx: Tx, scope: SchoolScope, id: string, input: ChangeStatusInput, ctx: ActionContext): Promise<Outcome> {
  const school = await loadSchoolContext(tx, scope);
  await lockStudentRow(tx, scope, id);
  const row = await findStudentRow(tx, scope, id);
  const plan = planTransition(row.status, input.to);
  if (plan === null) throw invalidTransition(row.status, input.to);
  if (plan.requireComplete) assertComplete(row, school, ctx.now);
  const released = plan.nisn === "CLAIM" ? await claimNisn(tx, { studentId: row.id, nisn: row.nisn }, ctx) : null;
  await persistTransition(tx, scope, row, input.to, plan, ctx.now);
  const revokedSessions = plan.revokeSessions ? await revokeAllSessions(tx, row.userId, "ACCOUNT_DISABLED", ctx.now) : 0;
  const voidedInvoiceIds = plan.voidFutureInvoices
    ? await voidFutureInvoicesForStudent(
        tx,
        { schoolId: scope.schoolId, studentId: row.id, todayLocal: localParts(ctx.now, school.timezone).ymd, reason: input.reason ?? "Siswa pindah" },
        ctx,
      )
    : [];
  await recordNisnReleases(tx, released ? [released] : [], ctx);
  await writeAudit(
    tx,
    {
      action: "student.status_change",
      entityType: "Student",
      entityId: row.id,
      schoolId: scope.schoolId,
      before: { status: row.status, userActive: row.user.isActive, hasActiveNisn: row.activeNisn !== null },
      after: { status: input.to, userActive: plan.userActive, reason: input.reason ?? null, nisnReleased: released !== null, revokedSessions, voidedInvoiceIds },
    },
    ctx,
  );
  return { nisnReleased: released !== null, revokedSessions, voidedInvoiceIds };
}

export async function changeStudentStatus(
  ctx: ActionContext,
  schoolId: string | undefined,
  id: string,
  input: ChangeStatusInput,
): Promise<StatusChangeResult> {
  const scope = scopeFor(ctx, schoolId);
  const outcome = await withStudentConflicts(() => withTx((tx) => applyStatusChange(tx, scope, id, input, ctx)));
  return { student: await loadStudentDetail(scope, id, ctx.now), ...outcome };
}

/** POST /school/students/{id}/activate = transisi ke ACTIVE (DRAFT/INACTIVE/GRADUATED/MOVED). */
export async function activateStudent(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<StatusChangeResult> {
  return changeStudentStatus(ctx, schoolId, id, { to: "ACTIVE" });
}
