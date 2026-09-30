import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/http/errors";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import type { LoginEmailBody } from "./auth-schemas";
import { verifyPassword } from "./password";
import { requirePrincipal, type ActionContext } from "./principal";
import { forgetTrustedDevices } from "./trusted-device";

/**
 * Pengaturan akun milik sendiri di halaman "Keamanan akun": email login tambahan (admin sekolah; NPSN tetap
 * berlaku untuk admin utama) dan "Lupakan perangkat tepercaya" (super admin ber-TOTP).
 */
const limiterKey = (userId: string): string => `login-email:${userId}`;
const emailTaken = () => conflict("EMAIL_TAKEN", "Email sudah dipakai akun lain.");

/** Konfirmasi kata sandi saat ini; salah dihitung limiter CHANGE_PASSWORD (5 kali/15 menit). */
async function confirmPassword(userId: string, password: string): Promise<{ email: string | null; schoolId: string | null }> {
  const key = limiterKey(userId);
  assertRateLimit("CHANGE_PASSWORD", key);
  const owner = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, email: true, schoolId: true } });
  if (!owner) throw notFound("Akun tidak ditemukan.");
  if (!(await verifyPassword(password, owner.passwordHash))) {
    getLimiter("CHANGE_PASSWORD").recordFailure(key);
    throw badRequest("CURRENT_PASSWORD_INVALID", "Kata sandi saat ini salah.");
  }
  getLimiter("CHANGE_PASSWORD").reset(key);
  return { email: owner.email, schoolId: owner.schoolId };
}

/** PUT /me/email: tambah/ubah email login. Email sama dengan yang tersimpan = tanpa perubahan. */
export async function updateLoginEmail(input: LoginEmailBody, ctx: ActionContext): Promise<{ email: string }> {
  const principal = requirePrincipal(ctx);
  const owner = await confirmPassword(principal.userId, input.currentPassword);
  if (owner.email?.toLowerCase() === input.email) return { email: input.email };
  await withTx(async (tx) => {
    await lockKey(tx, userLockKey(principal.userId));
    const holder = await tx.user.findFirst({ where: { email: input.email, id: { not: principal.userId } }, select: { id: true } });
    if (holder) throw emailTaken();
    await tx.user.update({ where: { id: principal.userId }, data: { email: input.email } });
    const audit = { before: { email: owner.email }, after: { email: input.email } };
    await writeAudit(tx, { action: "auth.login_email", entityType: "User", entityId: principal.userId, schoolId: owner.schoolId, ...audit }, ctx);
  }).catch((error: unknown) => {
    // P2002 = email direbut permintaan lain di antara cek dan tulis.
    if ((error as { code?: unknown } | null)?.code === "P2002") throw emailTaken();
    throw error;
  });
  return { email: input.email };
}

/** DELETE /me/trusted-devices: semua perangkat tepercaya dilupakan (login berikutnya meminta TOTP). */
export async function forgetMyTrustedDevices(ctx: ActionContext): Promise<{ removed: number }> {
  const principal = requirePrincipal(ctx);
  const removed = await withTx(async (tx) => {
    await lockKey(tx, userLockKey(principal.userId));
    const count = await forgetTrustedDevices(tx, principal.userId);
    await writeAudit(tx, { action: "auth.trusted_devices_forget", entityType: "User", entityId: principal.userId, after: { removed: count } }, ctx);
    return count;
  });
  return { removed };
}
