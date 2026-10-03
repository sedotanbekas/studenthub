import { z } from "zod";
import { LATE_REASON_CATEGORIES, LATE_REASON_NOTE_RAW_MAX, lateReasonNoteProblem, normalizeLateReasonNote } from "./late-reason-rules";

/** Skema zod alasan terlambat siswa (A1): masukan PUT, DTO alasan, hasil simpan, dan hitungan per kategori. */

const categorySchema = z.enum(LATE_REASON_CATEGORIES, "Pilih salah satu alasan.");

export const lateReasonSchema = z
  .object({
    category: categorySchema,
    note: z.string().nullable().meta({ description: "Keterangan siswa (maks. 200 karakter); wajib untuk OTHER." }),
    timeLocal: z.string().meta({ description: "Jam lokal sekolah saat terakhir diisi/diubah (HH:mm).", example: "07:35" }),
    updatedAt: z.string().meta({ description: "Instant server terakhir diisi/diubah (ISO UTC)." }),
  })
  .meta({ id: "AttendanceLateReason" });

export const lateReasonBody = z
  .strictObject({
    category: categorySchema.meta({ description: "Kode kategori; label di GET /meta/enums (LateReasonCategory)." }),
    note: z
      .string("Keterangan harus berupa teks.")
      .max(LATE_REASON_NOTE_RAW_MAX, "Keterangan maksimal 200 karakter.")
      .nullable()
      .optional()
      .transform(normalizeLateReasonNote)
      .meta({ description: "Opsional, kecuali OTHER (min. 5 karakter). Baris baru & spasi berlebih dirapikan, karakter tak terlihat dibuang; maks. 200 karakter." }),
  })
  .superRefine((value, ctx) => {
    const problem = lateReasonNoteProblem(value.category, value.note);
    if (problem) ctx.addIssue({ code: "custom", path: ["note"], message: problem });
  })
  .meta({ id: "AttendanceLateReasonInput" });
export type LateReasonBody = z.output<typeof lateReasonBody>;

export const lateReasonResultSchema = z
  .object({
    lateReason: lateReasonSchema,
    unchanged: z.boolean().meta({ description: "true bila alasan sama dengan yang tersimpan (tidak ditulis ulang, tanpa audit)." }),
    message: z.string(),
  })
  .meta({ id: "AttendanceLateReasonResult" });
export type LateReasonResultDto = z.infer<typeof lateReasonResultSchema>;

export const lateReasonCountsSchema = z
  .object({
    from: z.string().meta({ format: "date", example: "2026-09-01" }),
    to: z.string().meta({ format: "date", example: "2026-09-30" }),
    total: z.int().meta({ description: "filled + unfilled." }),
    filled: z.int().meta({ description: "Catatan TERLAMBAT yang berkategori alasan (sumber apa pun)." }),
    unfilled: z.int().meta({ description: "Check-in sendiri berstatus TERLAMBAT yang belum diisi alasannya." }),
    categories: z.array(z.object({ category: categorySchema, count: z.int() })).meta({ description: "Semua kategori, urut kode; tanpa catatan = 0." }),
  })
  .meta({ id: "MonitorLateReasonCounts" });
export type LateReasonCountsDto = z.infer<typeof lateReasonCountsSchema>;
