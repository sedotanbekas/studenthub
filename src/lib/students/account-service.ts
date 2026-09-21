import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { prisma, type Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { withTx } from "@/lib/tx";
import { auditSnapshot } from "./dto";
import { issueTemporaryPassword, type TemporaryCredential } from "./guards";
import { findStudentRow, lockStudentRow, scopeFor } from "./records";

/** Reset kata sandi siswa oleh admin & hapus siswa DRAFT. */
const IN_USE_MESSAGE = "Siswa sudah memiliki data terkait (absensi, rapor, tagihan, atau pengajuan) sehingga tidak dapat dihapus.";

export interface ResetPasswordResult {
  readonly temporaryPassword: string;
  readonly tempPasswordExpiresAt: string;
  readonly mustChangePassword: true;
  readonly revokedSessions: number;
}

async function applyReset(tx: Tx, scope: SchoolScope, id: string, credential: TemporaryCredential, ctx: ActionContext): Promise<number> {
  await lockStudentRow(tx, scope, id);
  const row = await findStudentRow(tx, scope, id);
  await tx.user.update({
    where: { id: row.userId },
    data: { passwordHash: credential.hash, mustChangePassword: true, tempPasswordExpiresAt: credential.expiresAt, passwordChangedAt: ctx.now },
  });
  const revoked = await revokeAllSessions(tx, row.userId, "ADMIN_REVOKED", ctx.now);
  await writeAudit(
    tx,
    {
      action: "student.reset_password",
      entityType: "Student",
      entityId: row.id,
      schoolId: scope.schoolId,
      after: { mustChangePassword: true, tempPasswordExpiresAt: credential.expiresAt, revokedSessions: revoked },
    },
    ctx,
  );
  return revoked;
}

/** Kata sandi baru SELALU di-generate (cost 8, 14 hari), wajib ganti saat login, semua sesi dicabut. */
export async function resetStudentPassword(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<ResetPasswordResult> {
  const scope = scopeFor(ctx, schoolId);
  await findStudentRow(prisma, scope, id);
  const credential = await issueTemporaryPassword(ctx.now);
  const revokedSessions = await withTx((tx) => applyReset(tx, scope, id, credential, ctx));
  return {
    temporaryPassword: credential.plain,
    tempPasswordExpiresAt: credential.expiresAt.toISOString(),
    mustChangePassword: true,
    revokedSessions,
  };
}

async function hasDependents(tx: Tx, studentId: string): Promise<boolean> {
  const where = { studentId };
  const counts = await Promise.all([
    tx.attendance.count({ where }),
    tx.checkInRejection.count({ where }),
    tx.leaveRequest.count({ where }),
    tx.reportCard.count({ where }),
    tx.invoice.count({ where }),
    tx.paymentSubmission.count({ where }),
    tx.announcementTarget.count({ where }),
  ]);
  return counts.some((count) => count > 0);
}

async function applyDelete(tx: Tx, scope: SchoolScope, id: string, ctx: ActionContext): Promise<void> {
  await lockStudentRow(tx, scope, id);
  const row = await findStudentRow(tx, scope, id);
  if (row.status !== "DRAFT") throw conflict("STUDENT_NOT_DRAFT", "Hanya siswa berstatus Draf yang dapat dihapus. Gunakan perubahan status untuk siswa lain.");
  if (await hasDependents(tx, row.id)) throw conflict("STUDENT_IN_USE", IN_USE_MESSAGE);
  await tx.student.deleteMany({ where: { id: row.id, schoolId: scope.schoolId, status: "DRAFT" } });
  await tx.user.deleteMany({ where: { id: row.userId, role: "STUDENT", schoolId: scope.schoolId } });
  await writeAudit(tx, { action: "student.delete", entityType: "Student", entityId: row.id, schoolId: scope.schoolId, before: auditSnapshot(row) }, ctx);
}

export async function deleteStudent(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<{ id: string; deleted: true }> {
  const scope = scopeFor(ctx, schoolId);
  try {
    await withTx((tx) => applyDelete(tx, scope, id, ctx));
  } catch (error) {
    // Rujukan baru muncul bersamaan (FK RESTRICT) -> tetap 409 domain.
    if ((error as { code?: unknown } | null)?.code === "P2003") throw conflict("STUDENT_IN_USE", IN_USE_MESSAGE);
    throw error;
  }
  return { id, deleted: true };
}
