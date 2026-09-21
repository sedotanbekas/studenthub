import { z } from "zod";
import { dateOutSchema, entityIdSchema, localDateSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import {
  LEAVE_REASON_MAX,
  LEAVE_REASON_MIN,
  LEAVE_TYPES,
  REVIEW_NOTE_MAX,
  REVIEW_NOTE_MIN,
  REVIEW_STATUSES,
  SEARCH_QUERY_MAX,
} from "./leave-constants";
import { LEAVE_SKIP_REASONS } from "./leave-rules";

/** Skema zod izin/sakit (validasi runtime + OpenAPI). Tanggal = tanggal lokal sekolah "YYYY-MM-DD". */

const leaveTypeSchema = z.enum(LEAVE_TYPES).meta({ description: "IZIN atau SAKIT." });
const reviewStatusSchema = z.enum(REVIEW_STATUSES);

const reasonInput = z
  .string()
  .trim()
  .min(LEAVE_REASON_MIN, `Alasan minimal ${LEAVE_REASON_MIN} karakter.`)
  .max(LEAVE_REASON_MAX, `Alasan maksimal ${LEAVE_REASON_MAX} karakter.`);

const attachmentInput = z
  .file()
  .meta({ description: "Foto surat/bukti (JPEG/PNG/WebP, maks 8 MiB). Wajib untuk SAKIT yang mencakup >= 3 hari sekolah." });

const optionalNote = z
  .string()
  .trim()
  .max(REVIEW_NOTE_MAX, `Catatan maksimal ${REVIEW_NOTE_MAX} karakter.`)
  .optional()
  .meta({ description: "Catatan peninjau (opsional)." });

const leaveInputShape = {
  type: leaveTypeSchema,
  startDate: localDateSchema,
  endDate: localDateSchema,
  reason: reasonInput,
  attachment: attachmentInput.optional(),
};

/** Multipart siswa: POST /student/leave-requests. */
export const createLeaveBody = z.strictObject(leaveInputShape).meta({ id: "CreateLeaveRequestInput" });
export type CreateLeaveInput = z.output<typeof createLeaveBody>;

/** Multipart admin: POST /school/leave-requests (langsung APPROVED + dimaterialisasi). */
export const createLeaveOnBehalfBody = z
  .strictObject({ studentId: entityIdSchema.meta({ description: "Id siswa di sekolah dalam cakupan." }), ...leaveInputShape, note: optionalNote })
  .meta({ id: "CreateLeaveOnBehalfInput" });
export type CreateLeaveOnBehalfInput = z.output<typeof createLeaveOnBehalfBody>;

export const approveLeaveBody = z.strictObject({ note: optionalNote }).meta({ id: "ApproveLeaveInput" });
export type ApproveLeaveInput = z.output<typeof approveLeaveBody>;

export const rejectLeaveBody = z
  .strictObject({
    note: z
      .string()
      .trim()
      .min(REVIEW_NOTE_MIN, `Alasan penolakan minimal ${REVIEW_NOTE_MIN} karakter.`)
      .max(REVIEW_NOTE_MAX, `Alasan penolakan maksimal ${REVIEW_NOTE_MAX} karakter.`)
      .meta({ description: "Alasan penolakan (wajib, dikirim ke siswa)." }),
  })
  .meta({ id: "RejectLeaveInput" });
export type RejectLeaveInput = z.output<typeof rejectLeaveBody>;

export const ownLeavesQuery = pageQuerySchema.extend({
  status: reviewStatusSchema.optional().meta({ description: "Filter status (default: semua)." }),
});
export type OwnLeavesQuery = z.output<typeof ownLeavesQuery>;

export const SCHOOL_LEAVE_STATUS_FILTERS = [...REVIEW_STATUSES, "ALL"] as const;

export const schoolLeavesQuery = schoolIdQuery
  .extend({
    ...pageQuerySchema.shape,
    status: z
      .enum(SCHOOL_LEAVE_STATUS_FILTERS)
      .default("PENDING")
      .meta({ description: "Default PENDING (antrean, terlama dulu); status lain/ALL terbaru dulu." }),
    from: localDateSchema.optional().meta({ description: "Izin yang beririsan dengan rentang from..to (inklusif)." }),
    to: localDateSchema.optional(),
    classId: entityIdSchema.optional().meta({ description: "Kelas siswa saat ini." }),
    q: z.string().trim().max(SEARCH_QUERY_MAX, `q maksimal ${SEARCH_QUERY_MAX} karakter.`).optional().meta({ description: "Nama memuat / awalan NIS." }),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, { message: "from tidak boleh setelah to.", path: ["from"] });
export type SchoolLeavesQuery = z.output<typeof schoolLeavesQuery>;

export const leaveIdParams = z.object({ id: entityIdSchema.meta({ description: "Id pengajuan izin." }) });

// ----------------------------------------------------------------------------- respons

const leaveShape = {
  id: z.string(),
  type: leaveTypeSchema,
  startDate: dateOutSchema,
  endDate: dateOutSchema,
  schoolDayCount: z.int().meta({ description: "Jumlah hari sekolah dalam rentang (kalender saat ini)." }),
  reason: z.string(),
  status: reviewStatusSchema,
  attachmentFileId: z.string().nullable().meta({ description: "Unduh lewat GET /api/v1/files/{id}." }),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable().meta({ format: "date-time" }),
  createdAt: z.string().meta({ format: "date-time" }),
};

export const leaveRequestSchema = z.object(leaveShape).meta({ id: "LeaveRequest" });
export type LeaveRequestDto = z.input<typeof leaveRequestSchema>;

const leaveStudentSchema = z
  .object({ id: z.string(), name: z.string(), nis: z.string(), className: z.string().nullable() })
  .meta({ id: "LeaveRequestStudent" });

const schoolLeaveShape = { ...leaveShape, student: leaveStudentSchema };

export const schoolLeaveSchema = z.object(schoolLeaveShape).meta({ id: "SchoolLeaveRequest" });
export type SchoolLeaveDto = z.input<typeof schoolLeaveSchema>;

export const schoolLeaveDetailSchema = z
  .object({
    ...schoolLeaveShape,
    schoolDays: z.array(dateOutSchema).meta({ description: "Hari sekolah dalam rentang (kalender saat ini)." }),
    reviewedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  })
  .meta({ id: "SchoolLeaveRequestDetail" });
export type SchoolLeaveDetailDto = z.input<typeof schoolLeaveDetailSchema>;

export const materializedSchema = z
  .object({
    created: z.array(dateOutSchema).meta({ description: "Hari sekolah yang mendapat baris IZIN/SAKIT baru." }),
    converted: z.array(dateOutSchema).meta({ description: "Baris Alpha otomatis yang diubah menjadi IZIN/SAKIT." }),
    skipped: z
      .array(z.object({ date: dateOutSchema, reason: z.enum(LEAVE_SKIP_REASONS) }))
      .meta({ description: "Dipertahankan: CHECKED_IN (sudah check-in), ADMIN_OVERRIDE (koreksi admin), ALREADY_LEAVE." }),
  })
  .meta({ id: "LeaveMaterialization" });
export type MaterializedDto = z.input<typeof materializedSchema>;

export const leaveDecisionSchema = z
  .object({ leaveRequest: schoolLeaveSchema, materialized: materializedSchema })
  .meta({ id: "LeaveApprovalResult" });
export type LeaveDecisionDto = z.input<typeof leaveDecisionSchema>;
