import { z } from "zod";
import { entityIdSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { correctedAttendanceSchema } from "./admin-schemas";
import { ANOMALY_CODES } from "./anomaly-rules";
import { ANOMALY_REVIEW_DECISIONS, REVIEW_NOTE_MAX, reviewNoteProblem } from "./anomaly-review-rules";

/** Skema zod tinjau anomali (B1): POST /school/attendance/{id}/anomaly-review + bentuk tinjauan di DTO monitoring. */

export const anomalyReviewSchema = z
  .object({
    decision: z.enum(ANOMALY_REVIEW_DECISIONS),
    note: z.string().nullable(),
    reviewedAt: z.string().meta({ format: "date-time" }),
    reviewer: z.object({ id: z.string(), name: z.string() }).nullable().meta({ description: "Akun admin yang meninjau." }),
  })
  .meta({ id: "AttendanceAnomalyReview" });
export type AnomalyReviewDto = z.infer<typeof anomalyReviewSchema>;

export const anomalyReviewParams = z.object({ id: entityIdSchema.meta({ description: "Id catatan absensi (sekolah lain -> 404)." }) });
export const anomalyReviewQuery = schoolIdQuery;

export const anomalyReviewBody = z
  .strictObject({
    decision: z.enum(ANOMALY_REVIEW_DECISIONS, "Pilih Valid atau Tidak valid.").meta({ description: "VALID = absensi tetap; INVALID = dikoreksi menjadi ALPHA." }),
    note: z
      .string("Catatan harus berupa teks.")
      .max(REVIEW_NOTE_MAX * 2, `Catatan maksimal ${REVIEW_NOTE_MAX} karakter.`)
      .nullable()
      .optional()
      .meta({ description: "Wajib (min. 5 karakter) untuk INVALID: disimpan sebagai catatan koreksi dan dikirim ke siswa. Opsional untuk VALID." }),
    flags: z
      .array(z.enum(ANOMALY_CODES))
      .max(ANOMALY_CODES.length)
      .meta({ description: "Kode flag yang dilihat admin saat memutuskan (dari detail catatan). Berbeda dengan flag tersimpan -> 409 ANOMALY_FLAGS_CHANGED." }),
  })
  .superRefine((value, ctx) => {
    const problem = reviewNoteProblem(value.decision, value.note);
    if (problem) ctx.addIssue({ code: "custom", path: ["note"], message: problem });
  })
  .meta({ id: "AttendanceAnomalyReviewInput" });
export type AnomalyReviewBody = z.output<typeof anomalyReviewBody>;

export const anomalyReviewResultSchema = z
  .object({
    attendance: correctedAttendanceSchema.extend({
      needsReview: z.boolean(),
      review: anomalyReviewSchema.nullable(),
    }),
    unchanged: z.boolean().meta({ description: "true bila keputusan sama dengan yang tersimpan (tanpa audit/notifikasi)." }),
    statusChanged: z.boolean().meta({ description: "true bila Tidak valid mengubah status menjadi ALPHA (siswa diberi tahu)." }),
  })
  .meta({ id: "AttendanceAnomalyReviewResult" });
export type AnomalyReviewResultDto = z.infer<typeof anomalyReviewResultSchema>;
