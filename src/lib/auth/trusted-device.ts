import { prisma, type Tx } from "@/lib/db";
import { TRUSTED_DEVICE_TTL_MS } from "./constants";
import { generateRefreshToken, hashRefreshToken } from "./refresh-rules";
import { trustAccepted } from "./trusted-device-rules";

/**
 * "Ingat perangkat ini" (super admin ber-TOTP, 30 hari): token opak 32 byte acak, DB hanya menyimpan hash
 * SHA-256. Web menyimpan token di cookie HttpOnly (src/app/api/web/[...path]/route.ts); mobile menyimpannya
 * sendiri dan mengirim `trustedDeviceToken` saat login. Dicabut bersama semua sesi akun (revokeAllSessions:
 * ganti/reset kata sandi, logout semua perangkat, penonaktifan) atau manual lewat DELETE /me/trusted-devices.
 */
export interface IssuedTrustedDevice {
  readonly token: string;
  readonly expiresAt: Date;
}

const USER_AGENT_MAX = 255;

/** Perangkat ini masih tepercaya untuk `userId`? Token kosong/asing/kedaluwarsa -> false (minta TOTP). */
export async function isTrustedDevice(userId: string, token: string | undefined, now: Date): Promise<boolean> {
  if (!token) return false;
  const row = await prisma.trustedDevice.findUnique({
    where: { tokenHash: hashRefreshToken(token) },
    select: { userId: true, expiresAt: true },
  });
  return trustAccepted(row, userId, now);
}

export interface TrustInput {
  readonly userId: string;
  readonly userAgent: string | null;
  readonly ip: string | null;
  readonly now: Date;
}

/** Terbitkan token perangkat tepercaya (di transaksi login, setelah kode TOTP diterima). */
export async function issueTrustedDevice(tx: Tx, input: TrustInput): Promise<IssuedTrustedDevice> {
  const { raw, hash } = generateRefreshToken();
  const expiresAt = new Date(input.now.getTime() + TRUSTED_DEVICE_TTL_MS);
  await tx.trustedDevice.create({
    data: {
      userId: input.userId,
      tokenHash: hash,
      userAgent: input.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
      ipAddress: input.ip,
      expiresAt,
    },
  });
  return { token: raw, expiresAt };
}

/** Lupakan semua perangkat tepercaya akun (login berikutnya kembali meminta kode TOTP). */
export async function forgetTrustedDevices(tx: Tx, userId: string): Promise<number> {
  const result = await tx.trustedDevice.deleteMany({ where: { userId } });
  return result.count;
}
