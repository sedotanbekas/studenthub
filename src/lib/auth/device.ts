import type { ClientPlatform, UserRole } from "@prisma/client";
import { MAX_ACTIVE_SESSIONS } from "./constants";

/**
 * Aturan murni perangkat & batas sesi saat login (tanpa Prisma).
 * - Satu akun aktif per perangkat mobile: sesi lain dengan deviceId sama dicabut (REPLACED).
 * - Satu sesi mobile aktif per siswa: login mobile siswa mencabut semua sesi ANDROID/IOS lainnya.
 * - Batas sesi hidup per peran: sesi tertua (lastUsedAt, lalu createdAt) diusir.
 */
export function isMobilePlatform(platform: ClientPlatform): boolean {
  return platform === "ANDROID" || platform === "IOS";
}

/** Siswa di app mobile wajib mengirim deviceId (dasar pengikatan perangkat & flag absensi). */
export function requiresDeviceId(role: UserRole, platform: ClientPlatform): boolean {
  return role === "STUDENT" && isMobilePlatform(platform);
}

export interface LiveSessionView {
  readonly id: string;
  readonly platform: ClientPlatform;
  readonly deviceId: string | null;
  readonly lastUsedAt: Date;
  readonly createdAt: Date;
}

export interface LoginRevocationInput {
  readonly role: UserRole;
  readonly platform: ClientPlatform;
  readonly deviceId: string | null;
  /** Sesi hidup milik user ini SEBELUM sesi baru dibuat. */
  readonly liveSessions: readonly LiveSessionView[];
  /** Default MAX_ACTIVE_SESSIONS[role]. */
  readonly maxActive?: number;
}

function isReplacedByLogin(session: LiveSessionView, input: LoginRevocationInput): boolean {
  if (!isMobilePlatform(input.platform)) return false;
  if (input.deviceId !== null && session.deviceId === input.deviceId) return true;
  return input.role === "STUDENT" && isMobilePlatform(session.platform);
}

function byOldestUse(a: LiveSessionView, b: LiveSessionView): number {
  return a.lastUsedAt.getTime() - b.lastUsedAt.getTime() || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

/** Id sesi milik user yang harus dicabut (REPLACED) agar sesi baru memenuhi aturan di atas. */
export function planLoginRevocations(input: LoginRevocationInput): string[] {
  const replaced = input.liveSessions.filter((s) => isReplacedByLogin(s, input));
  const replacedIds = new Set(replaced.map((s) => s.id));
  const remaining = input.liveSessions.filter((s) => !replacedIds.has(s.id));
  const maxActive = input.maxActive ?? MAX_ACTIVE_SESSIONS[input.role];
  const overflow = Math.max(0, remaining.length + 1 - maxActive);
  const evicted = [...remaining].sort(byOldestUse).slice(0, overflow);
  return [...replaced, ...evicted].map((s) => s.id);
}

export type DeviceBindingDecision = { readonly bind: true; readonly deviceId: string } | { readonly bind: false };

/** Login mobile siswa dengan deviceId berbeda dari perangkat terikat -> ikat ulang (dasar flag NEW_DEVICE). */
export function decideDeviceBinding(
  student: { readonly boundDeviceId: string | null },
  platform: ClientPlatform,
  deviceId: string | null,
): DeviceBindingDecision {
  if (!isMobilePlatform(platform) || deviceId === null || deviceId === student.boundDeviceId) return { bind: false };
  return { bind: true, deviceId };
}
