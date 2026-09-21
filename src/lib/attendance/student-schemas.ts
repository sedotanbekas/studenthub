import { AttendanceSource, AttendanceStatus, LeaveType, SchoolTimezone } from "@prisma/client";
import { z } from "zod";
import { dateOutSchema, entityIdSchema } from "@/lib/academics/schema-common";
import { DEVICE_ID_PATTERN } from "@/lib/auth/constants";
import { DAY_REASONS } from "@/lib/calendar/rules";
import { LOCATION_REJECT_CODES } from "./check-in-rules";

/** Skema zod v4 endpoint absensi siswa: hari ini, precheck, check-in, riwayat bulanan, ringkasan semester. */

/** Epoch ms yang masuk akal (2020-01-01 .. 2100-01-01); di luar itu jam perangkat jelas rusak. */
const MIN_EPOCH_MS = Date.UTC(2020, 0, 1);
const MAX_EPOCH_MS = Date.UTC(2100, 0, 1);
const MAX_ACCURACY_INPUT_M = 10_000;
const DECIMAL_TEXT = /^-?\d{1,5}(?:\.\d{1,15})?$/;
const EPOCH_TEXT = /^\d{1,16}$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const TIME_LOCAL = z.string().meta({ description: "Jam lokal sekolah HH:mm.", example: "07:05" });

/** Angka desimal dalam field multipart (string). String kosong / "0x10" / "1e3" ditolak 400. */
function decimalText(field: string, min: number, max: number, description: string, example: string) {
  return z
    .string()
    .trim()
    .regex(DECIMAL_TEXT, `${field} harus berupa angka desimal.`)
    .transform(Number)
    .pipe(z.number().min(min, `${field} minimal ${min}.`).max(max, `${field} maksimal ${max}.`))
    .meta({ description, example });
}

function epochText(field: string, description: string) {
  return z
    .string()
    .trim()
    .regex(EPOCH_TEXT, `${field} harus berupa epoch milidetik.`)
    .transform(Number)
    .pipe(z.int().min(MIN_EPOCH_MS, `${field} tidak masuk akal.`).max(MAX_EPOCH_MS, `${field} tidak masuk akal.`))
    .meta({ description, example: "1790000000000" });
}

const epochNumber = (field: string, description: string) =>
  z
    .int(`${field} harus bilangan bulat epoch milidetik.`)
    .min(MIN_EPOCH_MS, `${field} tidak masuk akal.`)
    .max(MAX_EPOCH_MS, `${field} tidak masuk akal.`)
    .meta({ description, example: 1790000000000 });

const LOCATION_TS_DESC = "LocationObject.timestamp (epoch ms, jam perangkat).";
const CLIENT_TIME_DESC = "Date.now() perangkat saat mengirim (epoch ms). Hanya untuk deteksi anomali; tanggal & jam ditentukan server.";
const ACCURACY_DESC = "Radius akurasi GPS (meter). Tidak dikirim atau > 100 m -> 422 GPS_ACCURACY_TOO_LOW.";

// ----------------------------------------------------------------------------- input

export const checkInBody = z
  .strictObject({
    selfie: z
      .file()
      .min(1, "Selfie wajib diisi.")
      .meta({ description: "Foto selfie JPEG/PNG/WebP (maks 5 MB, sisi terpendek >= 240 px). Di-re-encode 640 px tanpa EXIF." }),
    latitude: decimalText("latitude", -90, 90, "Lintang (derajat desimal).", "-6.9147"),
    longitude: decimalText("longitude", -180, 180, "Bujur (derajat desimal).", "107.6098"),
    accuracy: decimalText("accuracy", 0, MAX_ACCURACY_INPUT_M, ACCURACY_DESC, "12.5").optional(),
    mocked: z
      .enum(["true", "false"], "mocked harus 'true' atau 'false'.")
      .optional()
      .transform((value) => (value === undefined ? null : value === "true"))
      .meta({ description: "Flag mock Expo Location. 'true' -> 422 MOCK_LOCATION. Tidak dikirim = tidak diketahui (iOS)." }),
    locationTimestamp: epochText("locationTimestamp", LOCATION_TS_DESC),
    clientTime: epochText("clientTime", CLIENT_TIME_DESC),
    deviceId: z
      .string()
      .regex(DEVICE_ID_PATTERN, "deviceId harus 8-100 karakter [A-Za-z0-9._:-].")
      .meta({ description: "Id perangkat yang sama dengan saat login (Android: getAndroidId, iOS: getIosIdForVendorAsync)." }),
  })
  .meta({ id: "AttendanceCheckInInput" });
export type CheckInBody = z.output<typeof checkInBody>;

export const precheckBody = z
  .strictObject({
    latitude: z.number().min(-90, "latitude minimal -90.").max(90, "latitude maksimal 90.").meta({ example: -6.9147 }),
    longitude: z.number().min(-180, "longitude minimal -180.").max(180, "longitude maksimal 180.").meta({ example: 107.6098 }),
    accuracy: z.number().min(0).max(MAX_ACCURACY_INPUT_M).nullable().optional().meta({ description: ACCURACY_DESC, example: 12.5 }),
    mocked: z.boolean().nullable().optional().meta({ description: "Flag mock Expo Location; null/tidak dikirim = tidak diketahui." }),
    locationTimestamp: epochNumber("locationTimestamp", LOCATION_TS_DESC),
    clientTime: epochNumber("clientTime", CLIENT_TIME_DESC),
  })
  .meta({ id: "AttendancePrecheckInput" });
export type PrecheckBody = z.output<typeof precheckBody>;

export const historyQuery = z.object({
  month: z
    .string()
    .regex(MONTH_PATTERN, "month harus berformat YYYY-MM.")
    .optional()
    .meta({ description: "Default: bulan berjalan (waktu lokal sekolah). Maks 24 bulan ke belakang, tidak boleh bulan depan.", example: "2026-09" }),
});
export type HistoryQuery = z.output<typeof historyQuery>;

export const summaryQuery = z.object({
  termId: entityIdSchema.optional().meta({ description: "Default: semester yang mencakup hari ini, selain itu semester terakhir yang sudah dimulai." }),
});
export type SummaryQuery = z.output<typeof summaryQuery>;

// ----------------------------------------------------------------------------- respons

export const WINDOW_STATES = ["BEFORE_OPEN", "OPEN", "CLOSED"] as const;
export const BLOCK_REASONS = ["ALREADY_CHECKED_IN", "ATTENDANCE_ALREADY_RECORDED", "NOT_SCHOOL_DAY", "CHECKIN_NOT_OPEN", "CHECKIN_CLOSED"] as const;
export const PRECHECK_REASONS = [...BLOCK_REASONS, ...LOCATION_REJECT_CODES] as const;

const statusSchema = z.enum(AttendanceStatus);
const sourceSchema = z.enum(AttendanceSource);

export const todaySchema = z
  .object({
    date: dateOutSchema,
    serverTime: z.string().meta({ description: "Instant server (ISO UTC).", example: "2026-09-21T00:05:00.000Z" }),
    timezone: z.enum(SchoolTimezone),
    ianaTimezone: z.string().meta({ example: "Asia/Jakarta" }),
    schoolDay: z.object({ isSchoolDay: z.boolean(), reason: z.enum(DAY_REASONS), holidayName: z.string().nullable() }),
    window: z.object({
      opensAt: TIME_LOCAL,
      lateAfter: TIME_LOCAL.meta({ description: "Check-in SETELAH menit ini = TERLAMBAT (mulai + toleransi)." }),
      closesAt: TIME_LOCAL,
      state: z.enum(WINDOW_STATES),
    }),
    geofence: z.object({ radiusM: z.int(), maxAccuracyM: z.int() }).meta({ description: "Titik pusat geofence sengaja TIDAK dikirim." }),
    record: z
      .object({ id: z.string(), status: statusSchema, source: sourceSchema, checkInTimeLocal: TIME_LOCAL.nullable(), lateMinutes: z.int().nullable() })
      .nullable(),
    pendingLeave: z
      .object({ id: z.string(), type: z.enum(LeaveType), startDate: dateOutSchema, endDate: dateOutSchema })
      .nullable()
      .meta({ description: "Pengajuan izin/sakit PENDING yang mencakup hari ini." }),
    canCheckIn: z.boolean(),
    blockReason: z.enum(BLOCK_REASONS).nullable().meta({ description: "Null bila canCheckIn = true." }),
  })
  .meta({ id: "AttendanceToday" });
export type TodayDto = z.infer<typeof todaySchema>;

export const checkInAttendanceSchema = z
  .object({
    id: z.string(),
    date: dateOutSchema,
    status: statusSchema,
    lateMinutes: z.int().nullable(),
    checkInAt: z.string().meta({ description: "Instant server (ISO UTC)." }),
    checkInTimeLocal: TIME_LOCAL,
    distanceM: z.int().nullable(),
    source: sourceSchema,
  })
  .meta({ id: "AttendanceCheckInRecord" });

export const checkInResultSchema = z
  .object({ attendance: checkInAttendanceSchema, replayed: z.boolean(), message: z.string() })
  .meta({ id: "AttendanceCheckInResult" });
export type CheckInResultDto = z.infer<typeof checkInResultSchema>;

export const precheckResultSchema = z
  .object({
    ok: z.boolean(),
    reason: z.enum(PRECHECK_REASONS).nullable(),
    message: z.string(),
    distanceM: z.int().nullable().meta({ description: "Null bila lokasi (0,0)." }),
    radiusM: z.int(),
    window: z.enum(WINDOW_STATES),
    wouldBeLate: z.boolean(),
  })
  .meta({ id: "AttendancePrecheckResult" });
export type PrecheckResultDto = z.infer<typeof precheckResultSchema>;

const countsShape = { recorded: z.int(), izin: z.int(), sakit: z.int(), alpha: z.int() };
const presentPct = z.number().nullable().meta({ description: "(HADIR + TERLAMBAT) / tercatat x 100, 1 desimal; null bila belum ada catatan.", example: 93.3 });

export const historySchema = z
  .object({
    month: z.string().meta({ example: "2026-09" }),
    days: z.array(
      z.object({
        date: dateOutSchema,
        status: statusSchema,
        source: sourceSchema,
        checkInTimeLocal: TIME_LOCAL.nullable(),
        lateMinutes: z.int().nullable(),
        leaveRequestId: z.string().nullable(),
      }),
    ),
    nonSchoolDays: z.array(z.object({ date: dateOutSchema, reason: z.enum(DAY_REASONS), name: z.string().nullable() })),
    summary: z.object({ ...countsShape, present: z.int(), late: z.int(), presentPct }).meta({
      description: "Hanya hari yang sudah ditutup (s.d. kemarin, atau hari ini setelah jam akhir hari sekolah).",
    }),
  })
  .meta({ id: "AttendanceMonth" });
export type HistoryDto = z.infer<typeof historySchema>;

export const summarySchema = z
  .object({
    term: z.object({ id: z.string(), label: z.string(), startDate: dateOutSchema, endDate: dateOutSchema }),
    ...countsShape,
    hadir: z.int(),
    terlambat: z.int(),
    presentPct,
    closedThrough: dateOutSchema.nullable().meta({ description: "Tanggal terakhir yang dihitung; null bila belum ada hari yang ditutup di semester ini." }),
  })
  .meta({ id: "AttendanceTermSummary" });
export type SummaryDto = z.infer<typeof summarySchema>;
