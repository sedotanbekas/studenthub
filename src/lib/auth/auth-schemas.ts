import { z } from "zod";
import type { SchoolTimezone, SponsorStatus, StudentStatus } from "@prisma/client";
import {
  CLIENT_PLATFORMS,
  DEVICE_ID_PATTERN,
  DEVICE_NAME_MAX,
  EXPO_PUSH_TOKEN_PATTERN,
  IDENTIFIER_MAX,
  PASSWORD_INPUT_MAX,
  PUSH_TOKEN_MAX,
  REFRESH_TOKEN_INPUT_MAX,
  USER_ROLES,
} from "./constants";
import { classifyIdentifier } from "./identifier";
import { schoolThemeSchema } from "@/lib/schools/theme-schemas";

/** Skema zod domain auth: body request (strictObject) dan respons (dipakai kontrak + OpenAPI). */
const STUDENT_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "GRADUATED", "MOVED"] as const satisfies readonly StudentStatus[];
const SPONSOR_STATUSES = ["PENDING", "APPROVED", "SUSPENDED"] as const satisfies readonly SponsorStatus[];
const TIMEZONES = ["WIB", "WITA", "WIT"] as const satisfies readonly SchoolTimezone[];

const platformSchema = z.enum(CLIENT_PLATFORMS).meta({ description: "ANDROID/IOS = app mobile (Bearer), WEB = dashboard." });
const roleSchema = z.enum(USER_ROLES);
const instant = z.iso.datetime();
const totpCodeSchema = z.string().regex(/^\d{6}$/, "Kode TOTP harus 6 digit.").meta({ example: "123456" });

// ----------------------------------------------------------------------------- request

export const loginBodySchema = z
  .strictObject({
    identifier: z
      .string()
      .trim()
      .min(1)
      .max(IDENTIFIER_MAX)
      .refine((value) => classifyIdentifier(value).kind !== "INVALID", "Masukkan NISN 10 digit atau email yang valid.")
      .meta({ description: "NISN 10 digit (siswa) atau email (admin/sponsor/super admin).", example: "0012345678" }),
    password: z.string().min(1).max(PASSWORD_INPUT_MAX),
    platform: platformSchema,
    deviceId: z
      .string()
      .regex(DEVICE_ID_PATTERN, "deviceId harus 8-100 karakter [A-Za-z0-9._:-].")
      .optional()
      .meta({ description: "Wajib untuk siswa di ANDROID/IOS." }),
    deviceName: z.string().trim().min(1).max(DEVICE_NAME_MAX).optional(),
    expoPushToken: z
      .string()
      .max(PUSH_TOKEN_MAX)
      .regex(EXPO_PUSH_TOKEN_PATTERN, "Format token push Expo tidak valid.")
      .optional()
      .meta({ description: "Hanya untuk sesi ANDROID/IOS.", example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }),
    totpCode: totpCodeSchema
      .optional()
      .meta({ description: "Wajib untuk super admin yang sudah mengaktifkan TOTP (6 digit dari aplikasi autentikator)." }),
  })
  .meta({ id: "AuthLoginRequest" });

export const totpConfirmBodySchema = z.strictObject({ code: totpCodeSchema }).meta({ id: "AuthTotpConfirmRequest" });

export const refreshBodySchema = z.strictObject({ refreshToken: z.string().min(1).max(REFRESH_TOKEN_INPUT_MAX) }).meta({ id: "AuthRefreshRequest" });

export const changePasswordBodySchema = z
  .strictObject({
    currentPassword: z.string().min(1).max(PASSWORD_INPUT_MAX),
    newPassword: z.string().min(1).max(PASSWORD_INPUT_MAX),
  })
  .meta({ id: "AuthChangePasswordRequest" });

export const pushTokenBodySchema = z
  .strictObject({ expoPushToken: z.string().min(1).max(PUSH_TOKEN_MAX).meta({ example: "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" }) })
  .meta({ id: "AuthPushTokenRequest" });

export const sessionIdParams = z.object({ id: z.string().min(1).max(64) });

// ----------------------------------------------------------------------------- response

export const authUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    role: roleSchema,
    schoolId: z.string().nullable(),
    sponsorId: z.string().nullable(),
  })
  .meta({ id: "AuthUser" });

export const authTokensSchema = z
  .object({
    accessToken: z.string(),
    accessTokenExpiresAt: instant,
    refreshToken: z.string().meta({ description: "Token opak; simpan aman (SecureStore). Dirotasi setiap refresh." }),
    refreshTokenExpiresAt: instant,
    sessionId: z.string(),
    user: authUserSchema,
    mustChangePassword: z.boolean(),
  })
  .meta({ id: "AuthTokens" });

export const logoutResultSchema = z.object({ revoked: z.literal(true) });
export const logoutAllResultSchema = z.object({ revokedCount: z.int().min(0) });
export const changePasswordResultSchema = z.object({ changed: z.literal(true), otherSessionsRevoked: z.int().min(0) });
export const pushTokenRegisteredSchema = z.object({ registered: z.literal(true) });
export const pushTokenRemovedSchema = z.object({ removed: z.literal(true) });

export const meSchema = z
  .object({
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      role: roleSchema,
      mustChangePassword: z.boolean(),
      totpEnabled: z.boolean().meta({ description: "TOTP 2FA aktif (hanya relevan untuk super admin)." }),
      totpEnrollmentRequired: z
        .boolean()
        .meta({ description: "true = super admin belum mengaktifkan TOTP; semua aksi selain /auth/* & /me/* -> 403 TOTP_ENROLLMENT_REQUIRED." }),
      lastLoginAt: instant.nullable(),
    }),
    school: z
      .object({
        id: z.string(),
        name: z.string(),
        timezone: z.enum(TIMEZONES),
        /** Komponen SchoolTheme (selalu terisi; tema bawaan bila belum diatur admin). */
        theme: schoolThemeSchema,
      })
      .nullable(),
    student: z
      .object({ id: z.string(), nisn: z.string(), nis: z.string(), status: z.enum(STUDENT_STATUSES), className: z.string().nullable() })
      .nullable(),
    sponsor: z.object({ id: z.string(), companyName: z.string(), status: z.enum(SPONSOR_STATUSES) }).nullable(),
    permissions: z.array(z.string()).meta({ description: "Aksi POLICY yang boleh dijalankan pemanggil saat ini." }),
  })
  .meta({ id: "AuthMe" });

export const sessionItemSchema = z
  .object({
    id: z.string(),
    platform: platformSchema,
    deviceName: z.string().nullable(),
    ipAddress: z.string().nullable(),
    lastUsedAt: instant,
    createdAt: instant,
    isCurrent: z.boolean(),
  })
  .meta({ id: "AuthSessionItem" });

export const sessionListSchema = z.array(sessionItemSchema);

export const totpSetupSchema = z
  .object({
    secret: z.string().meta({ description: "Rahasia base32 (160 bit) — ditampilkan SEKALI; masukkan manual bila QR tidak bisa dipindai." }),
    otpauthUri: z.string().meta({ description: "Key URI `otpauth://totp/...` untuk dijadikan QR code di dashboard." }),
    issuer: z.string(),
    accountName: z.string(),
    algorithm: z.literal("SHA1"),
    digits: z.literal(6),
    period: z.literal(30),
  })
  .meta({ id: "AuthTotpSetup" });

export const totpConfirmResultSchema = z
  .object({
    enabled: z.literal(true),
    enabledAt: instant,
    otherSessionsRevoked: z.int().min(0).meta({ description: "Sesi lain (dibuat sebelum TOTP aktif) yang dicabut." }),
  })
  .meta({ id: "AuthTotpConfirmResult" });

export type LoginBody = z.output<typeof loginBodySchema>;
export type AuthTokens = z.input<typeof authTokensSchema>;
export type MeDto = z.input<typeof meSchema>;
export type SessionItem = z.input<typeof sessionItemSchema>;
export type TotpSetupDto = z.input<typeof totpSetupSchema>;
export type TotpConfirmResult = z.input<typeof totpConfirmResultSchema>;
