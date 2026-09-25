import type { ClientPlatform, UserRole } from "@prisma/client";
import { MAX_ACTIVE_SESSIONS } from "./constants";

/**
 * Aturan murni perangkat & batas sesi saat login (tanpa Prisma).
 * - "Perangkat absen" = app mobile (ANDROID/IOS), atau browser HP (WEB + user-agent HP) milik siswa yang
 *   mengirim deviceId (keputusan klien 2026-09-25: absensi boleh dari browser HP, bukan desktop).
 * - Satu akun aktif per perangkat absen: sesi lain dengan deviceId sama dicabut (REPLACED).
 * - Satu perangkat absen aktif per siswa: login siswa di perangkat absen mencabut sesi perangkat absen lainnya.
 * - Batas sesi hidup per peran: sesi tertua (lastUsedAt, lalu createdAt) diusir.
 */
export function isMobilePlatform(platform: ClientPlatform): boolean {
  return platform === "ANDROID" || platform === "IOS";
}

/**
 * Heuristik user-agent browser HP (Android, iPhone/iPod, iPad lama, token "Mobile"). Dapat dipalsukan:
 * lapisan penyaring tambahan, bukan jaminan — pengikatan deviceId & flag anomali tetap berlaku.
 */
const MOBILE_AGENT = /Android|iPhone|iPod|iPad|Mobile/i;
export function isMobileBrowserAgent(userAgent: string | null): boolean {
  return userAgent !== null && MOBILE_AGENT.test(userAgent);
}

export interface AttendanceSessionView {
  readonly platform: ClientPlatform;
  readonly deviceId: string | null;
  /** User-agent permintaan (untuk sesi WEB). */
  readonly userAgent: string | null;
}

/** Sesi yang boleh absen: app mobile ber-deviceId, atau browser HP ber-deviceId. */
export function canCheckInFromSession(session: AttendanceSessionView): boolean {
  if (session.deviceId === null) return false;
  return isMobilePlatform(session.platform) || (session.platform === "WEB" && isMobileBrowserAgent(session.userAgent));
}

/**
 * deviceId yang disimpan pada sesi: app mobile apa adanya; login WEB hanya dari browser HP (selain itu
 * null). Batas "absen hanya dari browser HP" ditegakkan server, tidak bergantung pada frontend.
 */
export function sessionDeviceId(platform: ClientPlatform, deviceId: string | null, userAgent: string | null): string | null {
  if (platform === "WEB" && !isMobileBrowserAgent(userAgent)) return null;
  return deviceId;
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
  /** User-agent login; menentukan apakah login WEB berasal dari browser HP. */
  readonly userAgent?: string | null;
  readonly liveSessions: readonly LiveSessionView[];
  /** Default MAX_ACTIVE_SESSIONS[role]. */
  readonly maxActive?: number;
}

/** Login yang mengklaim perangkat absen: app mobile, atau siswa di browser HP dengan deviceId. */
function claimsAttendanceDevice(input: LoginRevocationInput): boolean {
  if (isMobilePlatform(input.platform)) return true;
  return input.role === "STUDENT" && canCheckInFromSession({ platform: input.platform, deviceId: input.deviceId, userAgent: input.userAgent ?? null });
}

function isReplacedByLogin(session: LiveSessionView, input: LoginRevocationInput): boolean {
  if (!claimsAttendanceDevice(input)) return false;
  if (input.deviceId !== null && session.deviceId === input.deviceId) return true;
  return input.role === "STUDENT" && (isMobilePlatform(session.platform) || session.deviceId !== null);
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

/** Login siswa di perangkat absen dengan deviceId berbeda dari perangkat terikat -> ikat ulang (dasar flag NEW_DEVICE). */
export function decideDeviceBinding(
  student: { readonly boundDeviceId: string | null },
  platform: ClientPlatform,
  deviceId: string | null,
  userAgent: string | null = null,
): DeviceBindingDecision {
  if (!canCheckInFromSession({ platform, deviceId, userAgent }) || deviceId === null || deviceId === student.boundDeviceId) return { bind: false };
  return { bind: true, deviceId };
}
