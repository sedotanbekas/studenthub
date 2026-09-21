import { writeAudit } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { badRequest, conflict, notFound, unauthorized, unprocessable } from "@/lib/http/errors";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import { SESSION_INVALID_MESSAGE } from "./constants";
import {
  BCRYPT_COST,
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_VIOLATION_MESSAGES,
  verifyPassword,
  type PasswordContext,
} from "./password";
import { requirePrincipal, type ActionContext, type Principal } from "./principal";
import { revokeAllSessions } from "./sessions";

/**
 * POST /auth/change-password (sukarela maupun wajib saat login pertama). Sesi saat ini dipertahankan,
 * semua sesi lain dicabut (PASSWORD_CHANGED). Limiter CHANGE_PASSWORD hanya menghitung password lama salah.
 * Penulisan dijaga kunci user + compare-and-set hash (lihat writeNewPassword) agar reset admin yang
 * terjadi bersamaan tidak pernah tertimpa.
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

interface PasswordWrite {
  readonly principal: Principal;
  /** Pemilik saat verifikasi; `passwordHash`-nya menjadi syarat compare-and-set. */
  readonly owner: PasswordOwner;
  readonly newHash: string;
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

/** Sesi pemanggil harus masih hidup saat menulis (reset admin/logout/penonaktifan di tengah jalan mencabutnya). */
async function assertSessionAlive(tx: Tx, principal: Principal, now: Date): Promise<void> {
  const live = await tx.authSession.findFirst({
    where: { id: principal.sessionId, userId: principal.userId, revokedAt: null, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (!live) throw unauthorized("SESSION_INVALID", SESSION_INVALID_MESSAGE);
}

/**
 * Tulis kata sandi baru. bcrypt (verifikasi & hash) berjalan di luar transaksi, jadi penulisan dijaga:
 * 1. kunci user PERTAMA (sama dengan login, reset admin, dan mutasi status/sesi akun);
 * 2. sesi pemanggil masih hidup, bila tidak -> 401 SESSION_INVALID;
 * 3. compare-and-set pada hash yang tadi diverifikasi: 0 baris = kata sandi sudah diubah pihak lain
 *    (mis. reset siswa oleh sekolah, atau permintaan ganda) -> 409 PASSWORD_CHANGED_CONCURRENTLY.
 */
async function writeNewPassword(tx: Tx, write: PasswordWrite, ctx: ActionContext): Promise<number> {
  const { principal, owner } = write;
  await lockKey(tx, userLockKey(principal.userId));
  await assertSessionAlive(tx, principal, ctx.now);
  const updated = await tx.user.updateMany({
    where: { id: principal.userId, passwordHash: owner.passwordHash },
    data: { passwordHash: write.newHash, mustChangePassword: false, tempPasswordExpiresAt: null, passwordChangedAt: ctx.now },
  });
  if (updated.count === 0) {
    throw conflict("PASSWORD_CHANGED_CONCURRENTLY", "Kata sandi akun baru saja diubah dari tempat lain. Muat ulang lalu coba lagi.");
  }
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
  const newHash = await hashPassword(input.newPassword, BCRYPT_COST);
  const otherSessionsRevoked = await withTx((tx) => writeNewPassword(tx, { principal, owner, newHash }, ctx));
  getLimiter("CHANGE_PASSWORD").reset(key);
  return { changed: true, otherSessionsRevoked };
}
