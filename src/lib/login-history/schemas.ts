import { z } from "zod";
import { CLIENT_PLATFORMS } from "@/lib/auth/constants";
import { pageQuerySchema } from "@/lib/http/pagination";
import { USER_ROLES } from "@/lib/users/schemas";
import { LOGIN_FAILURE_CODES } from "./rules";

/** Skema zod riwayat masuk semua akun (GET /api/v1/platform/login-history, khusus super admin). */
export const LOGIN_STATUSES = ["SUCCESS", "FAILED"] as const;
const DEVICE_TYPES = ["MOBILE", "TABLET", "DESKTOP"] as const;
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const loginHistoryQuery = pageQuerySchema.extend({
  userId: z.string().trim().min(1).max(64).optional().meta({ description: "Filter satu akun." }),
  role: z.enum(USER_ROLES).optional().meta({ description: "Filter peran akun." }),
  schoolId: z.string().trim().min(1).max(64).optional().meta({ description: "Filter akun milik satu sekolah." }),
  status: z.enum(LOGIN_STATUSES).optional().meta({ description: "SUCCESS = berhasil masuk, FAILED = percobaan gagal." }),
  isNewDevice: booleanQuery.optional().meta({ description: "true = hanya login pertama dari perangkat baru." }),
});
export type LoginHistoryQuery = z.output<typeof loginHistoryQuery>;

const text = z.string().nullable();

export const loginEventSchema = z
  .object({
    id: z.string(),
    occurredAt: z.iso.datetime(),
    status: z.enum(LOGIN_STATUSES),
    failureReason: z.enum(LOGIN_FAILURE_CODES).nullable().meta({ description: "Hanya untuk status FAILED." }),
    user: z.object({
      id: z.string(),
      name: z.string(),
      email: z.string().nullable(),
      role: z.enum(USER_ROLES),
      school: z.object({ id: z.string(), name: z.string() }).nullable(),
    }),
    device: z.string().meta({ description: "Ringkasan perangkat, mis. `Chrome 141 · Windows 10/11 · Komputer`." }),
    isNewDevice: z.boolean().meta({ description: "Login berhasil pertama akun ini dari perangkat tersebut." }),
    location: text.meta({ description: "Perkiraan lokasi dari IP (DB-IP Lite), bukan GPS." }),
    isp: text.meta({ description: "Penyedia internet + nomor AS." }),
    ipAddress: text,
    platform: z.enum(CLIENT_PLATFORMS),
    deviceType: z.enum(DEVICE_TYPES).nullable(),
    browser: text,
    os: text,
    deviceModel: text,
    deviceName: text,
    deviceId: text.meta({ description: "Id perangkat/browser kiriman klien." }),
    countryCode: text,
    userAgent: text,
  })
  .meta({ id: "LoginEvent" });

export type LoginEventDto = z.input<typeof loginEventSchema>;
