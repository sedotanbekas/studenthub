import { z } from "zod";
import { pageQuerySchema } from "@/lib/http/pagination";
import { diffDays, monthRange, parseLocalDate } from "@/lib/time/zone";
import { ANOMALY_CODES } from "./anomaly-rules";
import { ANALYTICS_MAX_RANGE_DAYS, ATTENDANCE_STATUSES, STUDENT_TREND_DEFAULT_MONTHS, STUDENT_TREND_MAX_MONTHS } from "./attendance-stats";

/** Skema zod monitoring & analitik absensi admin (sumber validasi runtime + OpenAPI). */

const idString = z.string().trim().min(1, "Id wajib diisi.").max(64, "Id terlalu panjang.");
const dateOut = z.string().meta({ format: "date", example: "2026-09-21" });
const monthOut = z.string().meta({ example: "2026-09" });
const localDateInput = z
  .string()
  .trim()
  .refine((value) => parseLocalDate(value) !== null, "Tanggal harus berformat YYYY-MM-DD yang valid.")
  .meta({ format: "date", example: "2026-09-21" });
const monthInput = z
  .string()
  .trim()
  .refine((value) => monthRange(value) !== null, "month harus berformat YYYY-MM.")
  .meta({ example: "2026-09" });
const queryBoolean = z.enum(["true", "false"]).transform((value) => value === "true");

export const DAILY_STATUS_FILTERS = [...ATTENDANCE_STATUSES, "BELUM_ABSEN"] as const;
export type DailyStatusFilter = (typeof DAILY_STATUS_FILTERS)[number];
const ATTENDANCE_SOURCES = ["CHECKIN", "LEAVE", "AUTO_ALPHA", "ADMIN"] as const;
const REJECT_REASONS = ["OUTSIDE_GEOFENCE", "GPS_ACCURACY_TOO_LOW", "MOCK_LOCATION", "LOCATION_STALE", "INVALID_LOCATION"] as const;

// ----------------------------------------------------------------------------- input

export const monitorScopeQuery = z.object({
  schoolId: z
    .string()
    .trim()
    .max(64, "schoolId terlalu panjang.")
    .optional()
    .meta({ description: "Wajib untuk SUPER_ADMIN; admin sekolah boleh mengosongkan." }),
});

const dateField = localDateInput.optional().meta({ description: "Tanggal lokal sekolah (YYYY-MM-DD); default hari ini." });
const classField = idString
  .optional()
  .meta({ description: "Filter kelas: kelas snapshot untuk baris tercatat, kelas saat ini untuk yang belum absen. Kelas sekolah lain -> 404." });
const statusField = z.enum(DAILY_STATUS_FILTERS).optional().meta({ description: "BELUM_ABSEN = siswa aktif tanpa catatan pada hari sekolah itu." });
const monthField = monthInput.optional().meta({ description: "Bulan YYYY-MM; default bulan berjalan (waktu lokal sekolah)." });

export const dateScopeQuery = monitorScopeQuery.extend({ date: dateField });

export const dailyQuery = monitorScopeQuery.extend({
  date: dateField,
  classId: classField,
  status: statusField,
  anomaly: z.enum(["any"]).optional().meta({ description: "any = hanya catatan dengan flag anomali (MEDIUM/HIGH)." }),
  q: z.string().trim().min(1).max(100).optional().meta({ description: "Nama memuat / awalan NIS / awalan NISN." }),
  ...pageQuerySchema.shape,
});

export const mapQuery = monitorScopeQuery.extend({
  date: dateField,
  classId: classField,
  status: statusField,
  includeRejected: queryBoolean.optional().meta({ description: "true = sertakan percobaan check-in yang ditolak pada tanggal itu." }),
});

/** Rentang inklusif maks. ANALYTICS_MAX_RANGE_DAYS hari (dicek bila from & to diisi; sisanya di service). */
function refineRange(value: { from?: string; to?: string }, ctx: z.RefinementCtx): void {
  if (!value.from || !value.to) return;
  if (value.from > value.to) ctx.addIssue({ code: "custom", path: ["from"], message: "from tidak boleh setelah to." });
  else if (diffDays(value.to, value.from) + 1 > ANALYTICS_MAX_RANGE_DAYS) {
    ctx.addIssue({ code: "custom", path: ["to"], message: `Rentang maksimal ${ANALYTICS_MAX_RANGE_DAYS} hari.` });
  }
}

const rangeShape = {
  from: localDateInput.optional().meta({ description: "Awal rentang (inklusif)." }),
  to: localDateInput.optional().meta({ description: `Akhir rentang (inklusif), maks. ${ANALYTICS_MAX_RANGE_DAYS} hari dari from.` }),
};

export const anomaliesQuery = monitorScopeQuery
  .extend({ ...rangeShape, classId: classField, ...pageQuerySchema.shape })
  .superRefine(refineRange);

export const rejectionsQuery = monitorScopeQuery.extend({
  date: localDateInput.optional().meta({ description: "Default hari ini bila studentId kosong; dengan studentId tanpa date -> semua tanggal." }),
  studentId: idString.optional().meta({ description: "Siswa sekolah lain -> 404." }),
  ...pageQuerySchema.shape,
});

export const monthScopeQuery = monitorScopeQuery.extend({ month: monthField });

export const recordParams = z.object({ id: idString.meta({ description: "Id catatan absensi." }) });
export const classParams = z.object({ classId: idString.meta({ description: "Id kelas." }) });
export const studentParams = z.object({ studentId: idString.meta({ description: "Id siswa." }) });

export const classTrendQuery = monitorScopeQuery.extend(rangeShape).superRefine(refineRange);

export const studentTrendQuery = monitorScopeQuery.extend({
  months: z.coerce
    .number({ error: "months harus berupa angka." })
    .int("months harus bilangan bulat.")
    .min(1, "months minimal 1.")
    .max(STUDENT_TREND_MAX_MONTHS, `months maksimal ${STUDENT_TREND_MAX_MONTHS}.`)
    .default(STUDENT_TREND_DEFAULT_MONTHS)
    .meta({ description: `Jumlah bulan terakhir (termasuk bulan berjalan), default ${STUDENT_TREND_DEFAULT_MONTHS}.` }),
});

export type DailyQuery = z.infer<typeof dailyQuery>;
export type MapQuery = z.infer<typeof mapQuery>;
export type DateScopeQuery = z.infer<typeof dateScopeQuery>;
export type AnomaliesQuery = z.infer<typeof anomaliesQuery>;
export type RejectionsQuery = z.infer<typeof rejectionsQuery>;
export type MonthScopeQuery = z.infer<typeof monthScopeQuery>;
export type ClassTrendQuery = z.infer<typeof classTrendQuery>;
export type StudentTrendQuery = z.infer<typeof studentTrendQuery>;

// ----------------------------------------------------------------------------- respons

const pctOut = z.number().nullable().meta({ description: "Persen satu desimal; null bila penyebut 0 / hari non-sekolah." });
const statusOut = z.enum(ATTENDANCE_STATUSES);
const sourceOut = z.enum(ATTENDANCE_SOURCES);
const flagCodesOut = z.array(z.enum(ANOMALY_CODES)).meta({ description: "Kode flag anomali (terurut). Label & keparahan: lihat detail catatan." });

export const countsSchema = z
  .object({ hadir: z.int(), terlambat: z.int(), izin: z.int(), sakit: z.int(), alpha: z.int() })
  .meta({ id: "MonitorAttendanceCounts" });

const rateShape = {
  recorded: z.int().meta({ description: "Jumlah baris absensi (student-day) tercatat pada hari yang sudah ditutup." }),
  presentPct: pctOut,
  latePct: pctOut,
  izinPct: pctOut,
  sakitPct: pctOut,
  alphaPct: pctOut,
  counts: countsSchema,
};

export const todayStatsSchema = z
  .object({
    date: dateOut,
    isSchoolDay: z.boolean(),
    isClosed: z.boolean().meta({ description: "true bila jam lokal sudah melewati dayEndMinute (hari ditutup)." }),
    eligible: z.int().meta({ description: "Siswa ACTIVE yang sudah aktif pada hari ini." }),
    present: z.int(),
    late: z.int(),
    izin: z.int(),
    sakit: z.int(),
    alpha: z.int(),
    notYet: z.int(),
    presentPct: pctOut,
  })
  .meta({ id: "MonitorTodayStats" });

export const studentBriefSchema = z
  .object({ id: z.string(), nis: z.string(), nisn: z.string(), name: z.string(), className: z.string().nullable() })
  .meta({ id: "MonitorStudentBrief" });

export const attendanceBriefSchema = z
  .object({
    id: z.string(),
    status: statusOut,
    source: sourceOut,
    checkInTimeLocal: z.string().nullable().meta({ example: "07:12" }),
    lateMinutes: z.int().nullable(),
    distanceM: z.int().nullable(),
    accuracyM: z.int().nullable(),
    hasAnomaly: z.boolean(),
    flags: flagCodesOut,
    leaveRequestId: z.string().nullable(),
    note: z.string().nullable(),
  })
  .meta({ id: "MonitorAttendanceBrief" });

export const dailyRowSchema = z
  .object({ student: studentBriefSchema, attendance: attendanceBriefSchema.nullable() })
  .meta({ id: "MonitorDailyRow" });

export const anomalyRowSchema = z
  .object({ date: dateOut, student: studentBriefSchema, attendance: attendanceBriefSchema })
  .meta({ id: "MonitorAnomalyRow" });

const rejectionShape = {
  id: z.string(),
  reason: z.enum(REJECT_REASONS),
  reasonLabel: z.string(),
  latitude: z.number().nullable().meta({ description: "Dibulatkan 3 desimal; null bila > 2 km dari sekolah." }),
  longitude: z.number().nullable(),
  accuracyM: z.int().nullable(),
  distanceM: z.int().nullable(),
  isMocked: z.boolean().nullable(),
  deviceId: z.string().nullable(),
  timeLocal: z.string().meta({ example: "06:58" }),
  createdAt: z.string(),
};

export const rejectionRowSchema = z
  .object({ ...rejectionShape, date: dateOut, student: studentBriefSchema })
  .meta({ id: "MonitorRejectionRow" });

const mapPointSchema = z.object({
  attendanceId: z.string(),
  studentId: z.string(),
  name: z.string(),
  nis: z.string(),
  className: z.string().nullable(),
  status: statusOut,
  latitude: z.number(),
  longitude: z.number(),
  accuracyM: z.int().nullable(),
  distanceM: z.int().nullable(),
  checkInTimeLocal: z.string().nullable(),
  hasAnomaly: z.boolean(),
  flags: flagCodesOut,
});

const unlocatedSchema = z.object({
  studentId: z.string(),
  name: z.string(),
  nis: z.string(),
  className: z.string().nullable(),
  status: z.enum(DAILY_STATUS_FILTERS).meta({ description: "Biasanya IZIN/SAKIT/ALPHA/BELUM_ABSEN; catatan admin tanpa koordinat juga muncul di sini." }),
  attendanceId: z.string().nullable(),
});

const mapRejectedSchema = z.object({ ...rejectionShape, studentId: z.string(), name: z.string(), className: z.string().nullable() });

export const mapSchema = z
  .object({
    date: dateOut,
    isSchoolDay: z.boolean(),
    school: z.object({ latitude: z.number(), longitude: z.number(), radiusM: z.int() }),
    counts: countsSchema.extend({ notYet: z.int() }),
    points: z.array(mapPointSchema),
    unlocated: z.array(unlocatedSchema),
    rejected: z.array(mapRejectedSchema).optional().meta({ description: "Hanya bila includeRejected=true." }),
    truncated: z.boolean().meta({ description: "true bila salah satu daftar dipotong di batas 5000 (juga di meta.truncated)." }),
  })
  .meta({ id: "MonitorAttendanceMap" });

const recapTotalsSchema = z.object({
  eligible: z.int().meta({ description: "Tercatat + belum absen." }),
  hadir: z.int(),
  terlambat: z.int(),
  izin: z.int(),
  sakit: z.int(),
  alpha: z.int(),
  notYet: z.int(),
  presentPct: pctOut,
});

export const recapSchema = z
  .object({
    date: dateOut,
    isSchoolDay: z.boolean(),
    classes: z.array(recapTotalsSchema.extend({ classId: z.string().nullable(), className: z.string() })),
    totals: recapTotalsSchema,
  })
  .meta({ id: "MonitorClassRecap" });

const auditEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actor: z.object({ id: z.string(), name: z.string(), role: z.string() }).nullable(),
  before: z.unknown(),
  after: z.unknown(),
  createdAt: z.string(),
});

export const recordDetailSchema = z
  .object({
    id: z.string(),
    date: dateOut,
    status: statusOut,
    source: sourceOut,
    checkInAt: z.string().nullable(),
    checkInTimeLocal: z.string().nullable(),
    lateMinutes: z.int().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    accuracyM: z.int().nullable(),
    distanceM: z.int().nullable(),
    isMocked: z.boolean().nullable(),
    deviceId: z.string().nullable(),
    locationCapturedAt: z.string().nullable(),
    hasAnomaly: z.boolean(),
    flags: z.array(z.object({ code: z.enum(ANOMALY_CODES), label: z.string(), severity: z.enum(["LOW", "MEDIUM", "HIGH"]) })),
    leaveRequestId: z.string().nullable(),
    note: z.string().nullable(),
    classId: z.string().nullable(),
    className: z.string().nullable().meta({ description: "Kelas snapshot saat dicatat." }),
    student: studentBriefSchema,
    selfie: z
      .object({ fileId: z.string(), url: z.string().nullable(), purged: z.boolean() })
      .nullable()
      .meta({ description: "url = /api/v1/files/{id}; null setelah dihapus retensi (purged)." }),
    rejectionsSameDay: z.array(z.object(rejectionShape)),
    audit: z.array(auditEntrySchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .meta({ id: "MonitorAttendanceDetail" });

const rateSchema = z.object(rateShape);

export const classAnalyticsSchema = z
  .object({
    period: z.object({
      month: monthOut,
      from: dateOut,
      to: dateOut,
      closedThrough: dateOut,
      isPartial: z.boolean().meta({ description: "true bila bulan belum selesai ditutup (juga di meta)." }),
      unclosedDates: z.array(dateOut).meta({ description: "Hari sekolah tertutup tanpa JobRun auto-alpha SUCCEEDED (data mungkin belum lengkap)." }),
    }),
    school: rateSchema,
    classes: z.array(rateSchema.extend({ classId: z.string().nullable(), className: z.string() })),
  })
  .meta({ id: "MonitorClassAnalytics" });

export const summaryAnalyticsSchema = rateSchema
  .extend({
    month: monthOut,
    closedThrough: dateOut,
    isPartial: z.boolean(),
    prevMonth: monthOut,
    prevPresentPct: pctOut,
    deltaPp: z.number().nullable().meta({ description: "presentPct - prevPresentPct dalam poin persen." }),
  })
  .meta({ id: "MonitorSummaryAnalytics" });

export const classTrendSchema = z
  .object({
    classId: z.string(),
    className: z.string(),
    from: dateOut,
    to: dateOut,
    closedThrough: dateOut,
    days: z.array(rateSchema.extend({ date: dateOut, isSchoolDay: z.boolean() })),
  })
  .meta({ id: "MonitorClassTrend" });

export const studentTrendSchema = z
  .object({ student: studentBriefSchema, closedThrough: dateOut, months: z.array(rateSchema.extend({ month: monthOut })) })
  .meta({ id: "MonitorStudentTrend" });

export const studentMonthSchema = z
  .object({
    month: monthOut,
    student: studentBriefSchema,
    closedThrough: dateOut,
    days: z.array(
      z.object({
        id: z.string(),
        date: dateOut,
        status: statusOut,
        source: sourceOut,
        checkInTimeLocal: z.string().nullable(),
        lateMinutes: z.int().nullable(),
        leaveRequestId: z.string().nullable(),
      }),
    ),
    nonSchoolDays: z.array(z.object({ date: dateOut, reason: z.enum(["DAY_OFF", "HOLIDAY", "OUTSIDE_TERM"]), name: z.string().nullable() })),
    summary: z.object({
      recorded: z.int(),
      present: z.int(),
      late: z.int(),
      izin: z.int(),
      sakit: z.int(),
      alpha: z.int(),
      presentPct: pctOut,
    }),
  })
  .meta({ id: "MonitorStudentMonth" });

export type TodayStatsDto = z.infer<typeof todayStatsSchema>;
export type DailyRowDto = z.infer<typeof dailyRowSchema>;
export type AnomalyRowDto = z.infer<typeof anomalyRowSchema>;
export type RejectionRowDto = z.infer<typeof rejectionRowSchema>;
export type MapDto = z.infer<typeof mapSchema>;
// ----------------------------------------------------------------------------- meta non-paginasi

export const mapMetaSchema = z.object({ truncated: z.boolean().meta({ description: "Sama dengan data.truncated." }) }).meta({ id: "MonitorMapMeta" });
export const classAnalyticsMetaSchema = z
  .object({ isPartial: z.boolean(), unclosedDates: z.array(dateOut).meta({ description: "Sama dengan period.unclosedDates." }) })
  .meta({ id: "MonitorClassAnalyticsMeta" });
export const monthNavigationMetaSchema = z
  .object({ prevMonth: monthOut.meta({ description: "Bulan sebelumnya (YYYY-MM)." }), nextMonth: monthOut.meta({ description: "Bulan berikutnya (YYYY-MM)." }) })
  .meta({ id: "MonitorMonthNavigationMeta" });

export type RecapDto = z.infer<typeof recapSchema>;
export type RecordDetailDto = z.infer<typeof recordDetailSchema>;
export type ClassAnalyticsDto = z.infer<typeof classAnalyticsSchema>;
export type SummaryAnalyticsDto = z.infer<typeof summaryAnalyticsSchema>;
export type ClassTrendDto = z.infer<typeof classTrendSchema>;
export type StudentTrendDto = z.infer<typeof studentTrendSchema>;
export type StudentMonthDto = z.infer<typeof studentMonthSchema>;
