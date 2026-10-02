import type { ClientPlatform, Prisma } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { lookupIp } from "@/lib/geoip/lookup";
import { isAppError } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import { describeUserAgent, failureCodeOf } from "./rules";

/**
 * Pencatat riwayat masuk akun yang dipantau (shouldRecordLogin). Berhasil: di transaksi login yang sama
 * (setelah sesi dibuka). Gagal: setelah respons, tanpa ditunggu — waktu respons gagal yang dipadatkan tetap
 * sama untuk semua akun sehingga tidak membocorkan email mana yang milik super admin.
 */
export interface LoginAttempt {
  readonly userId: string;
  readonly platform: ClientPlatform;
  /** deviceId kiriman klien apa adanya (web desktop juga mengirim id browser). */
  readonly deviceId: string | null;
  readonly deviceName: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export type LoginEventBase = Omit<Prisma.LoginEventUncheckedCreateInput, "id" | "succeeded" | "failureCode" | "sessionId" | "isNewDevice" | "createdAt">;

const clip = (value: string | null, max: number): string | null => (value ? value.slice(0, max) : null);

/** Perangkat (user-agent) + perkiraan lokasi/ISP dari berkas DB-IP lokal (null bila belum diunduh). */
export async function describeAttempt(attempt: LoginAttempt): Promise<LoginEventBase> {
  const geo = await lookupIp(attempt.ip);
  return {
    userId: attempt.userId,
    platform: attempt.platform,
    ipAddress: clip(attempt.ip, 45),
    userAgent: clip(attempt.userAgent, 255),
    deviceId: clip(attempt.deviceId, 100),
    deviceName: clip(attempt.deviceName, 100),
    ...describeUserAgent(attempt.userAgent),
    city: geo?.city ?? null,
    region: geo?.region ?? null,
    countryCode: geo?.countryCode ?? null,
    asn: geo?.asn ?? null,
    isp: geo?.isp ?? null,
  };
}

/** Belum pernah ada login BERHASIL akun ini dari perangkat yang sama (deviceId; tanpa deviceId -> user-agent). */
async function isNewDevice(tx: Tx, base: LoginEventBase): Promise<boolean> {
  const sameDevice = base.deviceId ? { deviceId: base.deviceId } : { deviceId: null, userAgent: base.userAgent ?? null };
  const seen = await tx.loginEvent.findFirst({ where: { userId: base.userId, succeeded: true, ...sameDevice }, select: { id: true } });
  return seen === null;
}

export async function recordLoginSuccess(tx: Tx, base: LoginEventBase, sessionId: string): Promise<void> {
  const firstTime = await isNewDevice(tx, base);
  await tx.loginEvent.create({ data: { ...base, succeeded: true, sessionId, isNewDevice: firstTime } });
}

/** Tidak pernah melempar: galat pencatatan hanya dilog. Pemanggil tidak menunggu (`void`). */
export async function recordLoginFailure(attempt: LoginAttempt, error: unknown): Promise<void> {
  const failureCode = failureCodeOf(isAppError(error) ? error.code : null);
  if (failureCode === null) return;
  try {
    const base = await describeAttempt(attempt);
    await prisma.loginEvent.create({ data: { ...base, succeeded: false, failureCode } });
  } catch (cause) {
    log.error("login_history.failure_record_failed", safeErrorFields(cause));
  }
}
