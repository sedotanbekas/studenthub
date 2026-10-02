import Bowser from "bowser";
import type { ClientPlatform, DeviceType, UserRole } from "@prisma/client";

/**
 * Aturan murni riwayat masuk (tanpa Prisma). Tujuan (pemilik, 2026-10-02): membedakan SIAPA yang memakai
 * akun super admin setelah TOTP dimatikan — dari perangkat/browser, IP, ISP, dan perkiraan lokasi.
 */
export const LOGIN_HISTORY_ROLES: readonly UserRole[] = ["SUPER_ADMIN"];

export function shouldRecordLogin(role: UserRole): boolean {
  return LOGIN_HISTORY_ROLES.includes(role);
}

export interface DeviceInfo {
  readonly deviceType: DeviceType | null;
  readonly browser: string | null;
  readonly os: string | null;
  readonly deviceModel: string | null;
}

/** Panjang kolom browser/os/deviceModel di LoginEvent. */
const MAX_TEXT = 60;
const UNKNOWN_DEVICE: DeviceInfo = { deviceType: null, browser: null, os: null, deviceModel: null };
const DEVICE_TYPES: Readonly<Record<string, DeviceType>> = { desktop: "DESKTOP", mobile: "MOBILE", tablet: "TABLET" };
/** Model HP di user-agent Android ("Android 14; SM-A546E)"); "K" = user-agent tereduksi Chrome (bukan model). */
const ANDROID_MODEL = /Android [\d.]+; ([^;)]+?)(?: Build\/[^;)]*)?\)/;
const REDUCED_ANDROID_MODEL = "K";

function clip(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, MAX_TEXT) : null;
}

const joined = (...parts: Array<string | null | undefined>): string | null => clip(parts.filter(Boolean).join(" "));
const major = (version: string | undefined): string | undefined => version?.split(".")[0];

function osOf(os: { name?: string; version?: string; versionName?: string }): string | null {
  if (!os.name) return null;
  // NT 10.0 dipakai Windows 10 maupun 11; Safari membekukan versi macOS di 10.15.7.
  if (os.name === "Windows") return os.versionName === "10" ? "Windows 10/11" : joined("Windows", os.versionName);
  if (os.name === "macOS") return "macOS";
  return joined(os.name, os.version);
}

function modelOf(userAgent: string, platform: { vendor?: string; model?: string }): string | null {
  const parsed = joined(platform.vendor, platform.model);
  if (parsed) return parsed;
  const android = ANDROID_MODEL.exec(userAgent)?.[1]?.trim();
  return android && android !== REDUCED_ANDROID_MODEL ? clip(android) : null;
}

/** Jenis perangkat, browser (versi mayor), OS, dan model dari user-agent; tak dikenali -> null. */
export function describeUserAgent(userAgent: string | null): DeviceInfo {
  if (!userAgent?.trim()) return UNKNOWN_DEVICE;
  const parsed = Bowser.parse(userAgent);
  return {
    deviceType: DEVICE_TYPES[parsed.platform.type ?? ""] ?? null,
    browser: joined(parsed.browser.name, major(parsed.browser.version)),
    os: osOf(parsed.os),
    deviceModel: modelOf(userAgent, parsed.platform),
  };
}

const TYPE_LABELS: Readonly<Record<DeviceType, string>> = { DESKTOP: "Komputer", MOBILE: "HP", TABLET: "Tablet" };
const APP_LABELS: Readonly<Partial<Record<ClientPlatform, string>>> = { ANDROID: "Aplikasi Android", IOS: "Aplikasi iOS" };

/** Ringkasan satu baris untuk tabel, mis. "Chrome 141 · Windows 10/11 · Komputer". */
export function deviceSummary(event: DeviceInfo & { readonly platform: ClientPlatform; readonly deviceName: string | null }): string {
  const app = APP_LABELS[event.platform];
  if (app) return [app, event.deviceName].filter(Boolean).join(" · ");
  const kind = event.deviceModel ?? (event.deviceType ? TYPE_LABELS[event.deviceType] : null);
  const parts = [event.browser, event.os, kind].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Perangkat tidak dikenal";
}

export const LOGIN_FAILURE_CODES = ["WRONG_PASSWORD", "TOTP_INVALID", "ACCOUNT_INACTIVE", "TEMP_PASSWORD_EXPIRED", "OTHER"] as const;
export type LoginFailureCode = (typeof LOGIN_FAILURE_CODES)[number];

const PASSTHROUGH_CODES: ReadonlySet<string> = new Set(LOGIN_FAILURE_CODES.filter((code) => code !== "OTHER"));

/** TOTP_REQUIRED = langkah normal meminta kode (kata sandi benar), bukan percobaan gagal. */
const NOT_A_FAILURE = "TOTP_REQUIRED";

/** Kode galat login (AppError.code) atau kode tersimpan -> kode kegagalan (lainnya OTHER); null = tidak dicatat. */
export function failureCodeOf(errorCode: string | null): LoginFailureCode | null {
  if (errorCode === NOT_A_FAILURE) return null;
  if (errorCode === "INVALID_CREDENTIALS") return "WRONG_PASSWORD";
  return errorCode !== null && PASSTHROUGH_CODES.has(errorCode) ? (errorCode as LoginFailureCode) : "OTHER";
}
