import { z } from "zod";

/** Skema request (multipart) & respons impor siswa. */
const flag = (fallback: "true" | "false", description: string) =>
  z
    .enum(["true", "false"])
    .default(fallback)
    .transform((value) => value === "true")
    .meta({ description });

export const importStudentsBody = z
  .strictObject({
    file: z.file().meta({ description: "Berkas XLSX (sheet pertama) atau CSV UTF-8 (pemisah , atau ;), maks 2 MiB & 1.000 baris." }),
    dryRun: flag("true", "true (default) = hanya validasi & laporan; false = simpan (all-or-nothing)."),
    activate: flag("true", "true (default) = siswa langsung AKTIF (semua data wajib); false = DRAFT."),
  })
  .meta({ id: "ImportStudentsInput" });
export type ImportStudentsInput = z.output<typeof importStudentsBody>;

const reportRowSchema = z.object({
  row: z.int(),
  nisn: z.string().nullable(),
  name: z.string().nullable(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const importReportSchema = z
  .object({
    totalRows: z.int(),
    validRows: z.int(),
    errorRows: z.int(),
    warningRows: z.int(),
    rows: z.array(reportRowSchema),
  })
  .meta({ id: "StudentImportReport" });

export const importCredentialSchema = z
  .object({
    row: z.int(),
    nisn: z.string(),
    nis: z.string(),
    name: z.string(),
    className: z.string().nullable(),
    temporaryPassword: z.string(),
  })
  .meta({ id: "StudentImportCredential" });

export const importStudentsResponse = z.object({
  dryRun: z.boolean(),
  report: importReportSchema,
  created: z.int().optional().meta({ description: "Jumlah siswa dibuat (hanya saat commit)." }),
  credentials: z
    .array(importCredentialSchema)
    .optional()
    .meta({ description: "Kata sandi sementara per siswa — HANYA ditampilkan sekali saat commit." }),
});
export type ImportStudentsResult = z.input<typeof importStudentsResponse>;
