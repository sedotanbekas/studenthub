import type { ClientPlatform, UserRole } from "@prisma/client";

/**
 * Konstanta domain auth & sesi (docs/design/01-auth-tenancy-provisioning.md §3 + PLAN "Auth & sesi").
 * Murni: tanpa Prisma runtime (hanya tipe).
 */
export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Kelas platform: ANDROID/IOS = MOBILE (Bearer, app Expo); WEB = dashboard. */
export type PlatformClass = "MOBILE" | "WEB";

export const CLIENT_PLATFORMS = ["ANDROID", "IOS", "WEB"] as const satisfies readonly ClientPlatform[];
export const MOBILE_PLATFORMS = ["ANDROID", "IOS"] as const satisfies readonly ClientPlatform[];
export const USER_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT", "REGION_ADMIN"] as const satisfies readonly UserRole[];

/**
 * Umur absolut sesi (family refresh token); tidak diperpanjang oleh rotasi. WEB 30 hari (permintaan klien
 * 2026-09-28: login web tersimpan setidaknya 30 hari, menggantikan 7 hari / idle 12 jam).
 */
export const SESSION_ABSOLUTE_TTL_MS: Readonly<Record<PlatformClass, number>> = { MOBILE: 180 * DAY_MS, WEB: 30 * DAY_MS };
/** Umur idle refresh token: tidak dipakai selama ini => login ulang. */
export const REFRESH_IDLE_TTL_MS: Readonly<Record<PlatformClass, number>> = { MOBILE: 30 * DAY_MS, WEB: 30 * DAY_MS };
export const REFRESH_TOKEN_BYTES = 32;
/** Pemakaian ulang token yang sudah dirotasi dalam jendela ini = balapan (409), di luar = reuse (cabut sesi). */
export const REFRESH_RACE_GRACE_MS = 30_000;

/** Batas sesi hidup per peran; sesi tertua (lastUsedAt) dicabut saat login baru melampaui batas. */
export const MAX_ACTIVE_SESSIONS: Readonly<Record<UserRole, number>> = {
  STUDENT: 2,
  SCHOOL_ADMIN: 5,
  SPONSOR: 5,
  SUPER_ADMIN: 3,
  REGION_ADMIN: 3,
};

/** Respons login gagal dipadatkan minimal selama ini (menyamarkan ada/tidaknya akun). */
export const LOGIN_FAILURE_MIN_MS = 300;

export const IDENTIFIER_MAX = 191;
export const PASSWORD_INPUT_MAX = 200;
export const DEVICE_NAME_MAX = 100;
export const REFRESH_TOKEN_INPUT_MAX = 256;
export const PUSH_TOKEN_MAX = 255;
export const SESSION_LIST_MAX = 50;

export const NISN_PATTERN = /^\d{10}$/;
/** NPSN sekolah (8 digit) = login admin utama sekolah (User.primarySchoolId). */
export const NPSN_PATTERN = /^\d{8}$/;

/** "Ingat perangkat ini": login super admin dari perangkat tepercaya tanpa kode TOTP selama 30 hari. */
export const TRUSTED_DEVICE_TTL_MS = 30 * DAY_MS;
export const TRUSTED_DEVICE_TOKEN_BYTES = 32;
export const TRUSTED_DEVICE_TOKEN_MAX = 128;
export const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,100}$/;
export const EXPO_PUSH_TOKEN_PATTERN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export const INVALID_CREDENTIALS_MESSAGE = "NISN/NPSN/email atau kata sandi salah.";
export const SESSION_INVALID_MESSAGE = "Sesi tidak berlaku. Silakan login ulang.";
export const ACCOUNT_INACTIVE_MESSAGE = "Akun tidak aktif.";
