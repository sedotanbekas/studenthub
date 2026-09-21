import type { NotificationCategory } from "@prisma/client";
import { z } from "zod";
import { EMPTY_PATCH_MESSAGE, entityIdSchema, hasAnyField, schoolIdQuery } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import {
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_BODY_MAX,
  ANNOUNCEMENT_BODY_MIN,
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_STATUSES,
  ANNOUNCEMENT_TITLE_MAX,
  ANNOUNCEMENT_TITLE_MIN,
  CANCEL_REASON_MAX,
  MAX_CLASS_TARGETS,
  MAX_STUDENT_TARGETS,
  SEARCH_QUERY_MAX,
} from "./constants";
import { validateAudience, type AudienceInput } from "./rules";

/** Skema zod pengumuman admin sekolah (validasi runtime + OpenAPI). Isi = teks polos (tidak dirender HTML). */

const categorySchema = z.enum(ANNOUNCEMENT_CATEGORIES).meta({ description: "Kategori ikon feed (SYSTEM tidak diizinkan)." });
const audienceSchema = z.enum(ANNOUNCEMENT_AUDIENCES).meta({ description: "ALL = semua siswa aktif; CLASSES = kelas tertentu; STUDENTS = siswa tertentu." });
const statusSchema = z.enum(ANNOUNCEMENT_STATUSES);

const titleInput = z
  .string()
  .trim()
  .min(ANNOUNCEMENT_TITLE_MIN, `Judul minimal ${ANNOUNCEMENT_TITLE_MIN} karakter.`)
  .max(ANNOUNCEMENT_TITLE_MAX, `Judul maksimal ${ANNOUNCEMENT_TITLE_MAX} karakter.`);
const bodyInput = z
  .string()
  .trim()
  .min(ANNOUNCEMENT_BODY_MIN, "Isi pengumuman wajib diisi.")
  .max(ANNOUNCEMENT_BODY_MAX, `Isi pengumuman maksimal ${ANNOUNCEMENT_BODY_MAX} karakter.`)
  .meta({ description: "Teks polos; aplikasi menampilkannya apa adanya (tanpa HTML)." });
const classIdsInput = z
  .array(entityIdSchema)
  .min(1, "Pilih minimal 1 kelas.")
  .max(MAX_CLASS_TARGETS, `Maksimal ${MAX_CLASS_TARGETS} kelas.`)
  .meta({ description: "Wajib (hanya) untuk audience=CLASSES. Kelas aktif di sekolah ini." });
const studentIdsInput = z
  .array(entityIdSchema)
  .min(1, "Pilih minimal 1 siswa.")
  .max(MAX_STUDENT_TARGETS, `Maksimal ${MAX_STUDENT_TARGETS} siswa.`)
  .meta({ description: "Wajib (hanya) untuk audience=STUDENTS. Siswa non-DRAF di sekolah ini." });

const audienceFields = { audience: audienceSchema, classIds: classIdsInput.optional(), studentIds: studentIdsInput.optional() };

/** Laporkan pelanggaran kombinasi audiens/target sebagai issue zod (400 VALIDATION_FAILED). */
function refineAudience(value: Partial<AudienceInput>, ctx: z.RefinementCtx): void {
  if (value.audience === undefined) {
    if (value.classIds !== undefined || value.studentIds !== undefined) {
      ctx.addIssue({ code: "custom", path: ["audience"], message: "audience wajib dikirim bersama classIds/studentIds." });
    }
    return;
  }
  const issue = validateAudience({ audience: value.audience, classIds: value.classIds, studentIds: value.studentIds });
  if (issue) ctx.addIssue({ code: "custom", path: [issue.field], message: issue.message });
}

export const createAnnouncementBody = z
  .strictObject({
    category: categorySchema,
    title: titleInput,
    body: bodyInput,
    ...audienceFields,
    publishNow: z.boolean().default(false).meta({ description: "true = buat & langsung terbitkan dalam satu transaksi (0 penerima -> 422, draf tidak tersimpan)." }),
  })
  .superRefine(refineAudience)
  .meta({ id: "CreateAnnouncementInput" });
export type CreateAnnouncementInput = z.output<typeof createAnnouncementBody>;

/** PATCH draf: audience + target selalu dikirim sebagai satu blok (target diganti seluruhnya). */
export const updateAnnouncementBody = z
  .strictObject({
    category: categorySchema.optional(),
    title: titleInput.optional(),
    body: bodyInput.optional(),
    audience: audienceSchema.optional(),
    classIds: classIdsInput.optional(),
    studentIds: studentIdsInput.optional(),
  })
  .refine(hasAnyField, EMPTY_PATCH_MESSAGE)
  .superRefine(refineAudience)
  .meta({ id: "UpdateAnnouncementInput" });
export type UpdateAnnouncementInput = z.output<typeof updateAnnouncementBody>;

export const recipientPreviewBody = z.strictObject(audienceFields).superRefine(refineAudience).meta({ id: "AnnouncementRecipientPreviewInput" });
export type RecipientPreviewInput = z.output<typeof recipientPreviewBody>;

export const cancelAnnouncementBody = z
  .strictObject({
    reason: z
      .string()
      .trim()
      .max(CANCEL_REASON_MAX, `Alasan maksimal ${CANCEL_REASON_MAX} karakter.`)
      .optional()
      .meta({ description: "Alasan pembatalan/penarikan (dicatat di audit)." }),
  })
  .meta({ id: "CancelAnnouncementInput" });
export type CancelAnnouncementInput = z.output<typeof cancelAnnouncementBody>;

export const listAnnouncementsQuery = schoolIdQuery.extend({
  ...pageQuerySchema.shape,
  status: statusSchema.optional().meta({ description: "Filter status (default: semua)." }),
  category: categorySchema.optional(),
  q: z.string().trim().max(SEARCH_QUERY_MAX, `q maksimal ${SEARCH_QUERY_MAX} karakter.`).optional().meta({ description: "Judul memuat." }),
});
export type ListAnnouncementsQuery = z.output<typeof listAnnouncementsQuery>;

export const announcementIdParams = z.object({ id: entityIdSchema.meta({ description: "Id pengumuman." }) });

// ----------------------------------------------------------------------------- respons

const instant = z.string().meta({ format: "date-time" });
/** Respons memakai enum kategori lengkap (defensif); input tetap menolak SYSTEM. */
const categoryOutSchema = z.enum(["ACADEMIC", "FINANCE", "EVENT", "CALENDAR", "STUDENT_AFFAIRS", "SYSTEM"] as const satisfies readonly NotificationCategory[]);
const authorSchema = z.object({ id: z.string(), name: z.string() }).meta({ id: "AnnouncementAuthor" });

const listItemShape = {
  id: z.string(),
  category: categoryOutSchema,
  title: z.string(),
  audience: audienceSchema,
  status: statusSchema,
  publishedAt: instant.nullable(),
  cancelledAt: instant.nullable().meta({ description: "CANCELLED + publishedAt terisi = ditarik setelah terbit." }),
  recipientCount: z.int().nullable().meta({ description: "Jumlah penerima saat terbit (null untuk draf)." }),
  author: authorSchema,
  createdAt: instant,
  updatedAt: instant,
};

export const announcementListItemSchema = z.object(listItemShape).meta({ id: "AnnouncementListItem" });
export type AnnouncementListItemDto = z.input<typeof announcementListItemSchema>;

const targetsSchema = z
  .object({
    classes: z.array(z.object({ id: z.string(), name: z.string() })),
    students: z.array(z.object({ id: z.string(), name: z.string(), nis: z.string() })),
  })
  .meta({ id: "AnnouncementTargets" });

export const announcementDetailSchema = z
  .object({
    ...listItemShape,
    body: z.string(),
    targets: targetsSchema,
    stats: z
      .object({ recipientCount: z.int(), readCount: z.int() })
      .meta({ description: "readCount = notifikasi penerima yang sudah dibaca. Pengumuman ditarik -> 0 (notifikasi dihapus)." }),
  })
  .meta({ id: "AnnouncementDetail" });
export type AnnouncementDetailDto = z.input<typeof announcementDetailSchema>;

export const recipientPreviewSchema = z.object({ count: z.int() }).meta({ id: "AnnouncementRecipientPreview" });
export const deletedAnnouncementSchema = z.object({ id: z.string(), deleted: z.literal(true) }).meta({ id: "AnnouncementDeleted" });
