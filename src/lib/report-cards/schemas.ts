import { z } from "zod";
import { entityIdSchema, schoolIdQuery } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import {
  DESCRIPTION_MAX,
  MAX_BULK_GRADE_ROWS,
  MAX_CARD_GRADE_ROWS,
  MAX_PUBLISH_BATCH,
  MAX_UNPUBLISH_BATCH,
  SEARCH_QUERY_MAX,
  UNPUBLISH_REASON_MAX,
  UNPUBLISH_REASON_MIN,
} from "./constants";
import { MAX_SCORE, MIN_SCORE, normalizeDescription } from "./rules";

/** Skema zod rapor: masukan (validasi runtime) + keluaran (kontrak & OpenAPI). */

export const REPORT_CARD_STATUSES = ["DRAFT", "PUBLISHED"] as const;
export const GRADE_PREDICATES = ["A", "B", "C", "D"] as const;

export const reportCardStatusSchema = z.enum(REPORT_CARD_STATUSES).meta({ description: "DRAFT (draf) atau PUBLISHED (terbit)." });
const predicateSchema = z.enum(GRADE_PREDICATES).meta({ description: "Predikat K13 relatif KKM." });
const dateTimeOut = z.string().meta({ format: "date-time" });

const idOf = (description: string) => entityIdSchema.meta({ description });

const scoreInput = z
  .int("Nilai harus bilangan bulat.")
  .min(MIN_SCORE, `Nilai minimal ${MIN_SCORE}.`)
  .max(MAX_SCORE, `Nilai maksimal ${MAX_SCORE}.`)
  .nullable()
  .meta({ description: "Bilangan bulat 0-100; null menghapus nilai.", example: 88 });

const descriptionInput = z
  .string()
  .trim()
  .max(DESCRIPTION_MAX, `Deskripsi maksimal ${DESCRIPTION_MAX} karakter.`)
  .nullish()
  .transform((value) => (value === undefined ? undefined : normalizeDescription(value)))
  .meta({
    description: `Deskripsi capaian (maks ${DESCRIPTION_MAX}). Tidak dikirim = deskripsi tersimpan dipertahankan (nilai baru: null); null atau kosong = dihapus. Diabaikan bila score null.`,
  });

// ----------------------------------------------------------------------------- masukan

export const reportCardIdParams = z.object({ id: idOf("Id rapor.") });

export const sheetQuery = schoolIdQuery.extend({ termId: idOf("Id semester."), classId: idOf("Id kelas."), subjectId: idOf("Id mapel.") });
export type SheetQuery = z.output<typeof sheetQuery>;

export const readinessQuery = schoolIdQuery.extend({ termId: idOf("Id semester."), classId: idOf("Id kelas.") });
export type ReadinessQuery = z.output<typeof readinessQuery>;

export const listReportCardsQuery = schoolIdQuery.extend({
  ...pageQuerySchema.shape,
  termId: idOf("Default: semester aktif sekolah (tanpa semester aktif -> daftar kosong).").optional(),
  classId: idOf("Kelas rapor (snapshot kelas saat rapor dibuat).").optional(),
  status: reportCardStatusSchema.optional(),
  q: z.string().trim().max(SEARCH_QUERY_MAX, `q maksimal ${SEARCH_QUERY_MAX} karakter.`).optional().meta({ description: "Nama siswa memuat / awalan NIS." }),
});
export type ListReportCardsQuery = z.output<typeof listReportCardsQuery>;

const gradeEntryInput = z.strictObject({ studentId: idOf("Id siswa."), score: scoreInput, description: descriptionInput });

export const bulkGradesBody = z
  .strictObject({
    termId: idOf("Id semester."),
    classId: idOf("Id kelas."),
    subjectId: idOf("Id mapel (wajib dipetakan ke kelas)."),
    entries: z
      .array(gradeEntryInput)
      .min(1, "entries minimal 1 baris.")
      .max(MAX_BULK_GRADE_ROWS, `entries maksimal ${MAX_BULK_GRADE_ROWS} baris.`),
  })
  .meta({ id: "BulkReportCardGradesInput" });
export type BulkGradesInput = z.output<typeof bulkGradesBody>;

const cardGradeInput = z.strictObject({ subjectId: idOf("Id mapel."), score: scoreInput, description: descriptionInput });

export const cardGradesBody = z
  .strictObject({
    grades: z
      .array(cardGradeInput)
      .min(1, "grades minimal 1 baris.")
      .max(MAX_CARD_GRADE_ROWS, `grades maksimal ${MAX_CARD_GRADE_ROWS} baris.`),
  })
  .meta({ id: "ReportCardGradesInput" });
export type CardGradesInput = z.output<typeof cardGradesBody>;

export const createReportCardBody = z
  .strictObject({ studentId: idOf("Id siswa AKTIF yang punya kelas."), termId: idOf("Id semester (tahun ajaran = tahun ajaran kelas siswa).") })
  .meta({ id: "CreateReportCardInput" });
export type CreateReportCardInput = z.output<typeof createReportCardBody>;

export const publishBody = z
  .strictObject({
    termId: idOf("Id semester."),
    classId: idOf("Id kelas."),
    studentIds: z
      .array(entityIdSchema)
      .min(1, "studentIds minimal 1.")
      .max(MAX_PUBLISH_BATCH, `studentIds maksimal ${MAX_PUBLISH_BATCH}.`)
      .optional()
      .meta({ description: "Opsional: hanya siswa ini. Tanpa studentIds = seluruh rapor draf kelas + siswa aktif tanpa rapor." }),
  })
  .meta({ id: "PublishReportCardsInput" });
export type PublishInput = z.output<typeof publishBody>;

export const unpublishBody = z
  .strictObject({
    reportCardIds: z
      .array(entityIdSchema)
      .min(1, "reportCardIds minimal 1.")
      .max(MAX_UNPUBLISH_BATCH, `reportCardIds maksimal ${MAX_UNPUBLISH_BATCH}.`),
    reason: z
      .string()
      .trim()
      .min(UNPUBLISH_REASON_MIN, `Alasan minimal ${UNPUBLISH_REASON_MIN} karakter.`)
      .max(UNPUBLISH_REASON_MAX, `Alasan maksimal ${UNPUBLISH_REASON_MAX} karakter.`),
  })
  .meta({ id: "UnpublishReportCardsInput" });
export type UnpublishInput = z.output<typeof unpublishBody>;

// ----------------------------------------------------------------------------- keluaran

const termRefSchema = z.object({ id: z.string(), label: z.string().meta({ example: "Semester Ganjil 2026/2027" }) }).meta({ id: "ReportCardTermRef" });
const studentRefSchema = z.object({ id: z.string(), name: z.string(), nis: z.string() }).meta({ id: "ReportCardStudentRef" });
const attendanceCountsShape = { sick: z.int(), permit: z.int(), absent: z.int() };

export const sheetSchema = z
  .object({
    term: termRefSchema,
    class: z.object({ id: z.string(), name: z.string() }),
    subject: z.object({ id: z.string(), code: z.string(), name: z.string(), kkm: z.int() }),
    rows: z.array(
      z.object({
        studentId: z.string(),
        name: z.string(),
        nis: z.string(),
        studentStatus: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "GRADUATED", "MOVED"]).meta({ description: "Status siswa saat ini." }),
        reportCardId: z.string().nullable(),
        reportCardStatus: reportCardStatusSchema.nullable(),
        score: z.int().nullable(),
        predicate: predicateSchema.nullable().meta({ description: "DRAFT: dihitung dari KKM terkini; PUBLISHED: dibekukan." }),
        description: z.string().nullable(),
        blockedReason: z
          .enum(["PUBLISHED", "OTHER_CLASS"])
          .nullable()
          .meta({ description: "Tidak bisa diisi: rapor sudah terbit / rapor semester ini ada di kelas lain." }),
      }),
    ),
  })
  .meta({ id: "ReportCardGradeSheet" });
export type SheetDto = z.input<typeof sheetSchema>;

export const bulkGradesResultSchema = z
  .object({
    updated: z.int().meta({ description: "Nilai yang dibuat atau diubah." }),
    unchanged: z.int(),
    deleted: z.int(),
    createdReportCards: z.int(),
  })
  .meta({ id: "BulkReportCardGradesResult" });
export type BulkGradesResultDto = z.input<typeof bulkGradesResultSchema>;

export const reportCardListItemSchema = z
  .object({
    id: z.string(),
    student: studentRefSchema,
    termId: z.string(),
    classId: z.string(),
    className: z.string(),
    status: reportCardStatusSchema,
    gradedCount: z.int().meta({ description: "DRAFT: mapel terpetakan yang sudah dinilai; PUBLISHED: jumlah nilai." }),
    expectedCount: z.int().meta({ description: "DRAFT: jumlah mapel terpetakan kelas; PUBLISHED: jumlah nilai." }),
    average: z.number().nullable(),
    publishedAt: dateTimeOut.nullable(),
    updatedAt: dateTimeOut,
  })
  .meta({ id: "ReportCardListItem" });
export type ReportCardListItemDto = z.input<typeof reportCardListItemSchema>;

export const reportCardDetailSchema = z
  .object({
    id: z.string(),
    student: studentRefSchema,
    term: termRefSchema,
    classId: z.string(),
    className: z.string(),
    status: reportCardStatusSchema,
    publishedAt: dateTimeOut.nullable(),
    grades: z.array(
      z.object({
        subjectId: z.string(),
        subjectName: z.string(),
        kkm: z.int(),
        score: z.int(),
        predicate: predicateSchema,
        description: z.string().nullable(),
        isMapped: z.boolean().meta({ description: "false = mapel sudah tidak dipetakan ke kelas (nilai tetap disimpan)." }),
      }),
    ),
    missingSubjectIds: z.array(z.string()).meta({ description: "Mapel terpetakan yang belum dinilai (DRAFT); PUBLISHED selalu []." }),
    attendanceSummary: z
      .object({
        ...attendanceCountsShape,
        isSnapshot: z.boolean().meta({ description: "true = dibekukan saat terbit; false = dihitung langsung (DRAFT)." }),
        unclosedDates: z
          .array(z.string().meta({ format: "date" }))
          .meta({ description: "DRAFT: hari sekolah dalam rentang rekap yang belum ditutup auto-ALPHA (rekap belum final; terbit ditolak 422 ATTENDANCE_NOT_CLOSED). PUBLISHED: []." }),
      })
      .meta({ description: "Jumlah hari SAKIT/IZIN/ALPHA dari awal semester s.d. min(akhir semester, hari tertutup terakhir)." }),
    average: z.number().nullable(),
    updatedAt: dateTimeOut,
  })
  .meta({ id: "ReportCardDetail" });
export type ReportCardDetailDto = z.input<typeof reportCardDetailSchema>;

const cardRefSchema = z.object({ reportCardId: z.string(), studentId: z.string() });

export const readinessSchema = z
  .object({
    term: termRefSchema,
    class: z.object({ id: z.string(), name: z.string() }),
    subjectCount: z.int(),
    ready: z.array(cardRefSchema),
    incomplete: z.array(cardRefSchema.extend({ missingSubjectIds: z.array(z.string()) })),
    noReportCard: z.array(z.string()).meta({ description: "Siswa AKTIF kelas ini yang belum punya rapor semester ini." }),
    published: z.array(cardRefSchema),
    attendanceUnclosedDates: z
      .array(z.string().meta({ format: "date" }))
      .meta({ description: "Peringatan: hari sekolah dalam rentang rekap kehadiran yang belum ditutup auto-ALPHA. Selama tidak kosong, terbit ditolak 422 ATTENDANCE_NOT_CLOSED." }),
  })
  .meta({ id: "ReportCardReadiness" });
export type ReadinessDto = z.input<typeof readinessSchema>;

export const publishResultSchema = z
  .object({ publishedIds: z.array(z.string()), notified: z.int().meta({ description: "Jumlah notifikasi REPORT_CARD_PUBLISHED yang dibuat." }) })
  .meta({ id: "PublishReportCardsResult" });
export type PublishResultDto = z.input<typeof publishResultSchema>;

export const unpublishResultSchema = z.object({ unpublishedIds: z.array(z.string()) }).meta({ id: "UnpublishReportCardsResult" });
export type UnpublishResultDto = z.input<typeof unpublishResultSchema>;

export const deletedReportCardSchema = z.object({ id: z.string() });

export const ownReportCardItemSchema = z
  .object({ id: z.string(), termId: z.string(), termLabel: z.string(), className: z.string(), publishedAt: dateTimeOut, average: z.number().nullable() })
  .meta({ id: "OwnReportCardItem" });
export type OwnReportCardItemDto = z.input<typeof ownReportCardItemSchema>;

export const ownReportCardDetailSchema = z
  .object({
    id: z.string(),
    termId: z.string(),
    termLabel: z.string(),
    className: z.string(),
    publishedAt: dateTimeOut,
    grades: z.array(z.object({ subjectName: z.string(), kkm: z.int(), score: z.int(), predicate: predicateSchema, description: z.string().nullable() })),
    attendance: z.object(attendanceCountsShape),
    average: z.number().nullable(),
  })
  .meta({ id: "OwnReportCardDetail" });
export type OwnReportCardDetailDto = z.input<typeof ownReportCardDetailSchema>;
