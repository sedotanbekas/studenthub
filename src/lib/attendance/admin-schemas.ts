import { z } from "zod";
import { dateOutSchema, entityIdSchema, localDateSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { DAY_REASONS } from "@/lib/calendar/rules";
import {
  ATTENDANCE_SOURCES,
  ATTENDANCE_STATUSES,
  CORRECTION_REASON_MAX,
  CORRECTION_REASON_MIN,
  LATE_MINUTES_MAX,
  LATE_MINUTES_MIN,
  lateMinutesProblem,
} from "./correction-rules";

/** Skema zod koreksi absensi oleh admin (PUT /school/attendance/students/{studentId}/days/{date}). */

export const correctionParams = z.object({
  studentId: entityIdSchema.meta({ description: "Id siswa (milik sekolah dalam cakupan; sekolah lain -> 404)." }),
  date: localDateSchema.meta({ description: "Tanggal lokal sekolah yang dikoreksi (YYYY-MM-DD)." }),
});

export const correctionQuery = schoolIdQuery;

export const correctionBody = z
  .strictObject({
    status: z.enum(ATTENDANCE_STATUSES).meta({ description: "Status hasil koreksi." }),
    lateMinutes: z
      .int()
      .min(LATE_MINUTES_MIN)
      .max(LATE_MINUTES_MAX)
      .nullable()
      .optional()
      .meta({ description: `Menit setelah bel masuk (${LATE_MINUTES_MIN}-${LATE_MINUTES_MAX}); wajib untuk TERLAMBAT, dilarang untuk status lain.` }),
    reason: z
      .string()
      .trim()
      .min(CORRECTION_REASON_MIN, `Alasan minimal ${CORRECTION_REASON_MIN} karakter.`)
      .max(CORRECTION_REASON_MAX, `Alasan maksimal ${CORRECTION_REASON_MAX} karakter.`)
      .meta({ description: "Alasan koreksi (disimpan sebagai catatan, diaudit, dan dikirim ke siswa)." }),
  })
  .superRefine((value, ctx) => {
    const problem = lateMinutesProblem(value.status, value.lateMinutes);
    if (problem) ctx.addIssue({ code: "custom", path: ["lateMinutes"], message: problem });
  });

export type CorrectionBody = z.output<typeof correctionBody>;

export const correctedAttendanceSchema = z.object({
  id: z.string(),
  studentId: z.string(),
  classId: z.string().nullable().meta({ description: "Snapshot kelas saat baris dibuat." }),
  date: dateOutSchema,
  status: z.enum(ATTENDANCE_STATUSES),
  source: z.enum(ATTENDANCE_SOURCES),
  lateMinutes: z.int().nullable(),
  checkInAt: z.string().nullable().meta({ format: "date-time", description: "Waktu check-in (UTC); null untuk koreksi/izin/alpha." }),
  note: z.string().nullable(),
  leaveRequestId: z.string().nullable(),
  hasAnomaly: z.boolean(),
  updatedAt: z.string().meta({ format: "date-time" }),
});

export type CorrectedAttendanceDto = z.infer<typeof correctedAttendanceSchema>;

export const correctionResponse = z.object({
  attendance: correctedAttendanceSchema,
  unchanged: z.boolean().meta({ description: "true bila status & menit terlambat sama (tanpa audit/notifikasi)." }),
});

export type CorrectionResultDto = z.infer<typeof correctionResponse>;

// ----------------------------------------------------------------------------- tutup-ulang hari (super admin)

export const recloseDayBody = z
  .strictObject({
    schoolId: entityIdSchema.meta({ description: "Sekolah yang harinya ditutup ulang." }),
    date: localDateSchema.meta({ description: "Tanggal lokal sekolah yang sudah ditutup (YYYY-MM-DD)." }),
  })
  .meta({ id: "AttendanceRecloseDayInput" });

export type RecloseDayBody = z.output<typeof recloseDayBody>;

export const recloseDayResponse = z
  .object({
    schoolId: z.string(),
    date: dateOutSchema,
    isSchoolDay: z.boolean(),
    skippedReason: z.enum(DAY_REASONS).nullable().meta({ description: "Alasan bukan hari sekolah (libur/di luar semester/hari libur mingguan); null bila ditutup." }),
    planned: z.int().meta({ description: "Siswa wajib absen tanpa baris pada tanggal itu." }),
    inserted: z.int().meta({ description: "Baris ALPHA/LEAVE yang benar-benar ditulis." }),
    alphaPlanned: z.int(),
    leavePlanned: z.int(),
    anomaliesSwept: z.int().meta({ description: "Baris check-in yang ditandai SHARED_DEVICE oleh sapuan." }),
  })
  .meta({ id: "AttendanceRecloseDayResult" });

export type RecloseDayDto = z.infer<typeof recloseDayResponse>;
