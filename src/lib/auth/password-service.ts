import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, notFound, unprocessable } from "@/lib/http/errors";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { withTx } from "@/lib/tx";
import {
  BCRYPT_COST,
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_VIOLATION_MESSAGES,
  verifyPassword,
  type PasswordContext,
} from "./password";
import { requirePrincipal, type ActionContext } from "./principal";
import { revokeAllSessions } from "./sessions";

/**
 * POST /auth/change-password (sukarela maupun wajib saat login pertama). Sesi saat ini dipertahankan,
 * semua sesi lain dicabut (PASSWORD_CHANGED). Limiter CHANGE_PASSWORD hanya menghitung password lama salah.
 */
export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

interface PasswordOwner {
  readonly passwordHash: string;
  readonly email: string | null;
  readonly schoolId: string | null;
  readonly mustChangePassword: boolean;
  readonly student: { readonly nisn: string; readonly nis: string; readonly birthDate: Date | null } | null;
}

const limiterKey = (userId: string): string => `chpw:${userId}`;

async function loadOwner(userId: string): Promise<PasswordOwner> {
  const owner = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      email: true,
      schoolId: true,
      mustChangePassword: true,
      student: { select: { nisn: true, nis: true, birthDate: true } },
    },
  });
  if (!owner) throw notFound("Akun tidak ditemukan.");
  return owner;
}

function assertNewPasswordAllowed(input: ChangePasswordInput, owner: PasswordOwner): void {
  const context: PasswordContext = {
    nisn: owner.student?.nisn ?? null,
    nis: owner.student?.nis ?? null,
    email: owner.email,
    birthDate: owner.student?.birthDate ?? null,
  };
  const violations = checkPasswordPolicy(input.newPassword, context);
  if (violations.length > 0) {
    const messages = violations.map((violation) => PASSWORD_VIOLATION_MESSAGES[violation]);
    throw unprocessable("PASSWORD_POLICY", messages[0] ?? "Kata sandi baru tidak memenuhi kebijakan.", { violations, messages });
  }
  // Password lama sudah terverifikasi, jadi kesamaan string = kesamaan dengan hash saat ini.
  if (input.newPassword === input.currentPassword) {
    throw unprocessable("PASSWORD_REUSED", "Kata sandi baru harus berbeda dari kata sandi saat ini.");
  }
}

export async function changePassword(
  input: ChangePasswordInput,
  ctx: ActionContext,
): Promise<{ changed: true; otherSessionsRevoked: number }> {
  const principal = requirePrincipal(ctx);
  const key = limiterKey(principal.userId);
  assertRateLimit("CHANGE_PASSWORD", key);
  const owner = await loadOwner(principal.userId);
  if (!(await verifyPassword(input.currentPassword, owner.passwordHash))) {
    getLimiter("CHANGE_PASSWORD").recordFailure(key);
    throw badRequest("CURRENT_PASSWORD_INVALID", "Kata sandi saat ini salah.");
  }
  assertNewPasswordAllowed(input, owner);
  const passwordHash = await hashPassword(input.newPassword, BCRYPT_COST);
  const otherSessionsRevoked = await withTx(async (tx) => {
    await tx.user.update({
      where: { id: principal.userId },
      data: { passwordHash, mustChangePassword: false, tempPasswordExpiresAt: null, passwordChangedAt: ctx.now },
      select: { id: true },
    });
    const revoked = await revokeAllSessions(tx, principal.userId, "PASSWORD_CHANGED", ctx.now, principal.sessionId);
    await writeAudit(
      tx,
      {
        action: "auth.password_change",
        entityType: "User",
        entityId: principal.userId,
        schoolId: owner.schoolId,
        after: { forcedChange: owner.mustChangePassword, otherSessionsRevoked: revoked },
      },
      ctx,
    );
    return revoked;
  });
  getLimiter("CHANGE_PASSWORD").reset(key);
  return { changed: true, otherSessionsRevoked };
}
