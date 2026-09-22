import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError, conflict, notFound, unauthorized, unprocessable } from "@/lib/http/errors";
import { assertRateLimit, getLimiter } from "@/lib/http/rate-limits";
import { log } from "@/lib/log";
import { withTx } from "@/lib/tx";
import type { TotpConfirmResult, TotpSetupDto } from "./auth-schemas";
import type { ActionContext } from "./principal";
import { requirePrincipal } from "./principal";
import { lockUserSessions } from "./session-service";
import { revokeAllSessions } from "./sessions";
import { decryptTotpSecret, encryptTotpSecret, parseTotpKey } from "./totp-crypto";
import {
  base32Encode,
  buildOtpauthUri,
  TOTP_DIGITS,
  TOTP_ISSUER,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  verifyTotp,
} from "./totp-rules";

/**
 * TOTP 2FA super admin: pendaftaran (/me/totp/setup -> /me/totp/confirm), verifikasi saat login, dan
 * reset darurat (CLI `pnpm db:totp-reset`). Rahasia disimpan terenkripsi (totp-crypto.ts); setiap kode yang
 * diterima menaikkan User.totpLastUsedStep lewat compare-and-set sehingga kode yang sama tidak bisa dipakai
 * dua kali (juga saat dua login paralel).
 */
const TOTP_INVALID_MESSAGE = "Kode verifikasi (TOTP) salah atau sudah dipakai.";

export const totpLimiterKey = (userId: string): string => `totp:${userId}`;

function totpKey(): Buffer {
  const key = parseTotpKey(getEnv().TOTP_ENC_KEY);
  if (!key) throw new Error("TOTP_ENC_KEY tidak valid (bug: seharusnya ditolak env.ts)");
  return key;
}

/** Rahasia terdekripsi; gagal (kunci diganti/data rusak) dilog tanpa rahasia lalu 500. */
function readSecret(blob: string, userId: string): Buffer {
  const secret = decryptTotpSecret(blob, userId, totpKey());
  if (secret) return secret;
  log.error("totp.secret_unreadable", { userId });
  throw new AppError(500, "INTERNAL_ERROR", "Rahasia TOTP tidak dapat dibaca. Hubungi operator untuk reset TOTP.");
}

function toSetupDto(secret: Buffer, accountName: string): TotpSetupDto {
  const secretBase32 = base32Encode(secret);
  return {
    secret: secretBase32,
    otpauthUri: buildOtpauthUri({ secretBase32, accountName, issuer: TOTP_ISSUER }),
    issuer: TOTP_ISSUER,
    accountName,
    algorithm: "SHA1",
    digits: TOTP_DIGITS,
    period: TOTP_PERIOD_SECONDS,
  };
}

/**
 * POST /me/totp/setup: buat rahasia baru (menimpa pendaftaran yang belum dikonfirmasi) dan kembalikan
 * SEKALI. TOTP yang sudah aktif -> 409 TOTP_ALREADY_ENABLED (reset hanya lewat CLI operator).
 */
export async function setupTotp(ctx: ActionContext): Promise<TotpSetupDto> {
  const principal = requirePrincipal(ctx);
  return withTx(async (tx) => {
    await lockUserSessions(tx, principal.userId);
    const user = await tx.user.findUnique({ where: { id: principal.userId }, select: { email: true, totpEnabledAt: true } });
    if (!user) throw notFound("Akun tidak ditemukan.");
    if (user.totpEnabledAt) throw conflict("TOTP_ALREADY_ENABLED", "TOTP sudah aktif untuk akun ini.");
    const secret = randomBytes(TOTP_SECRET_BYTES);
    await tx.user.update({
      where: { id: principal.userId },
      data: { totpSecretEnc: encryptTotpSecret(secret, principal.userId, totpKey()), totpLastUsedStep: null },
    });
    return toSetupDto(secret, user.email ?? principal.name);
  });
}

type ConfirmOutcome = { readonly ok: true; readonly revoked: number } | { readonly ok: false };

async function enableTotp(tx: Tx, ctx: ActionContext, code: string): Promise<ConfirmOutcome> {
  const principal = requirePrincipal(ctx);
  await lockUserSessions(tx, principal.userId);
  const user = await tx.user.findUnique({
    where: { id: principal.userId },
    select: { totpSecretEnc: true, totpEnabledAt: true, totpLastUsedStep: true },
  });
  if (!user) throw notFound("Akun tidak ditemukan.");
  if (user.totpEnabledAt) throw conflict("TOTP_ALREADY_ENABLED", "TOTP sudah aktif untuk akun ini.");
  const secret = user.totpSecretEnc ? decryptTotpSecret(user.totpSecretEnc, principal.userId, totpKey()) : null;
  if (!secret) throw conflict("TOTP_SETUP_REQUIRED", "Mulai pendaftaran lewat /me/totp/setup terlebih dahulu.");
  const result = verifyTotp(secret, code, ctx.now, user.totpLastUsedStep);
  if (!result.ok) return { ok: false };
  await tx.user.update({ where: { id: principal.userId }, data: { totpEnabledAt: ctx.now, totpLastUsedStep: result.step } });
  // Sesi lain dibuat hanya dengan kata sandi (sebelum TOTP aktif) -> dicabut agar tidak ikut naik hak.
  const revoked = await revokeAllSessions(tx, principal.userId, "ADMIN_REVOKED", ctx.now, principal.sessionId);
  await writeAudit(tx, { action: "auth.totp_enable", entityType: "User", entityId: principal.userId, after: { enabledAt: ctx.now, otherSessionsRevoked: revoked } }, ctx);
  return { ok: true, revoked };
}

/** POST /me/totp/confirm: kode pertama yang benar mengaktifkan TOTP. Kode salah dihitung limiter TOTP_VERIFY. */
export async function confirmTotp(code: string, ctx: ActionContext): Promise<TotpConfirmResult> {
  const principal = requirePrincipal(ctx);
  const key = totpLimiterKey(principal.userId);
  assertRateLimit("TOTP_VERIFY", key);
  const outcome = await withTx((tx) => enableTotp(tx, ctx, code));
  if (!outcome.ok) {
    getLimiter("TOTP_VERIFY").recordFailure(key);
    throw unprocessable("TOTP_CODE_INVALID", "Kode verifikasi salah atau kedaluwarsa. Pastikan jam perangkat akurat lalu coba lagi.");
  }
  getLimiter("TOTP_VERIFY").reset(key);
  return { enabled: true, enabledAt: ctx.now.toISOString(), otherSessionsRevoked: outcome.revoked };
}

export interface TotpLoginAccount {
  readonly userId: string;
  readonly totpSecretEnc: string | null;
  readonly totpLastUsedStep: number | null;
}

/**
 * Verifikasi kode TOTP saat login (di luar transaksi). Mengembalikan langkah yang diterima; kode salah atau
 * replay -> hitung limiter lalu `null` (pemanggil memadatkan waktu dan melempar TOTP_INVALID).
 */
export function checkLoginTotpCode(account: TotpLoginAccount, code: string, now: Date): number | null {
  const key = totpLimiterKey(account.userId);
  assertRateLimit("TOTP_VERIFY", key);
  if (!account.totpSecretEnc) return null;
  const result = verifyTotp(readSecret(account.totpSecretEnc, account.userId), code, now, account.totpLastUsedStep);
  if (!result.ok) {
    getLimiter("TOTP_VERIFY").recordFailure(key);
    return null;
  }
  getLimiter("TOTP_VERIFY").reset(key);
  return result.step;
}

export const totpInvalid = (): AppError => unauthorized("TOTP_INVALID", TOTP_INVALID_MESSAGE);

/**
 * Compare-and-set langkah TOTP di transaksi login: hanya berhasil bila langkah ini LEBIH BESAR dari yang
 * tersimpan. Dua login paralel dengan kode yang sama -> hanya satu yang lolos, lainnya 401 TOTP_INVALID.
 */
export async function consumeTotpStep(tx: Tx, userId: string, step: number): Promise<void> {
  const updated = await tx.user.updateMany({
    where: { id: userId, totpEnabledAt: { not: null }, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
    data: { totpLastUsedStep: step },
  });
  if (updated.count === 0) throw totpInvalid();
}

export class TotpResetTargetError extends Error {
  constructor(email: string) {
    super(`Super admin dengan email ${email} tidak ditemukan.`);
    this.name = "TotpResetTargetError";
  }
}

export interface TotpResetResult {
  readonly userId: string;
  readonly wasEnabled: boolean;
  readonly sessionsRevoked: number;
}

/**
 * Reset darurat TOTP super admin (CLI operator, bukan HTTP): hapus rahasia + status aktif, cabut semua
 * sesinya, audit. Setelah login berikutnya akun wajib mendaftar ulang (TOTP_ENROLLMENT_REQUIRED).
 */
export async function resetSuperAdminTotp(email: string, now: Date = new Date()): Promise<TotpResetResult> {
  const target = await prisma.user.findFirst({ where: { email, role: "SUPER_ADMIN" }, select: { id: true } });
  if (!target) throw new TotpResetTargetError(email);
  return withTx(async (tx) => {
    await lockUserSessions(tx, target.id);
    const before = await tx.user.findUnique({ where: { id: target.id }, select: { totpEnabledAt: true } });
    await tx.user.update({ where: { id: target.id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastUsedStep: null } });
    const sessionsRevoked = await revokeAllSessions(tx, target.id, "ADMIN_REVOKED", now);
    const wasEnabled = Boolean(before?.totpEnabledAt);
    await writeAudit(
      tx,
      { action: "auth.totp_reset", entityType: "User", entityId: target.id, before: { enabled: wasEnabled }, after: { enabled: false, sessionsRevoked, via: "cli" } },
      { principal: null, ip: null, userAgent: "cli:totp-reset" },
    );
    return { userId: target.id, wasEnabled, sessionsRevoked };
  });
}
