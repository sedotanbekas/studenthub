import { NotificationCategory, NotificationType } from "@prisma/client";
import { z } from "zod";
import { cursorQuerySchema } from "@/lib/http/cursor";
import { INBOX_KINDS } from "./inbox-filters";

/** Skema zod inbox notifikasi (request + respons). Respons dipakai juga untuk OpenAPI. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const instant = z.iso.datetime().meta({ description: "Instant UTC (ISO 8601).", example: "2026-09-21T01:30:00.000Z" });
const categorySchema = z.enum(NotificationCategory).meta({ description: "Kategori ikon feed." });

export const inboxKindSchema = z.enum(INBOX_KINDS).meta({
  description: "all = semua; announcement = hanya pengumuman sekolah; personal = selain pengumuman.",
});

export const listInboxQuerySchema = cursorQuerySchema.extend({
  kind: inboxKindSchema.default("all"),
  category: categorySchema.optional(),
  unreadOnly: z
    .enum(["true", "false"], { error: "unreadOnly harus true atau false." })
    .default("false")
    .transform((value) => value === "true")
    .meta({ description: "true = hanya yang belum dibaca." }),
});
export type ListInboxQuery = z.output<typeof listInboxQuerySchema>;

export const notificationIdParams = z.object({
  id: z.string().regex(ID_RE, "id notifikasi tidak valid."),
});

export const readAllBodySchema = z.strictObject({
  before: z.iso
    .datetime({ offset: true, error: "before harus instant ISO 8601, mis. 2026-09-21T01:30:00Z." })
    .transform((value) => new Date(value))
    .optional()
    .meta({ description: "Hanya tandai item dengan createdAt <= before (waktu daftar diambil). Default: sekarang." }),
  kind: inboxKindSchema.optional(),
});
export type ReadAllBody = z.output<typeof readAllBodySchema>;

export const inboxLinkSchema = z
  .object({ screen: z.string(), id: z.string(), count: z.int().optional() })
  .meta({ id: "InboxLink", description: "Payload deep link, mis. {screen:'invoice', id}." });

export const inboxItemSchema = z
  .object({
    id: z.string(),
    type: z.enum(NotificationType),
    category: categorySchema,
    title: z.string(),
    body: z.string().meta({ description: "Pratinjau teks polos (<= 500 karakter)." }),
    data: inboxLinkSchema.nullable(),
    announcementId: z.string().nullable(),
    readAt: instant.nullable(),
    createdAt: instant,
  })
  .meta({ id: "InboxItem" });
export type InboxItemDto = z.input<typeof inboxItemSchema>;

export const inboxListSchema = z.array(inboxItemSchema);

export const inboxAnnouncementSchema = z
  .object({ id: z.string(), category: categorySchema, title: z.string(), body: z.string(), publishedAt: instant.nullable() })
  .meta({ id: "InboxAnnouncement", description: "Isi lengkap pengumuman sekolah." });
export type InboxAnnouncementDto = z.input<typeof inboxAnnouncementSchema>;

export const inboxDetailSchema = inboxItemSchema
  .extend({ announcement: inboxAnnouncementSchema.nullable() })
  .meta({ id: "InboxDetail" });
export type InboxDetailDto = z.input<typeof inboxDetailSchema>;

export const unreadCountSchema = z
  .object({
    total: z.int().min(0),
    announcements: z.int().min(0),
    personal: z.int().min(0),
    latestCreatedAt: instant.nullable(),
  })
  .meta({ id: "UnreadCount" });
export type UnreadCountDto = z.input<typeof unreadCountSchema>;

export const markReadResultSchema = z.object({ id: z.string(), readAt: instant }).meta({ id: "NotificationReadResult" });
export type MarkReadDto = z.input<typeof markReadResultSchema>;

export const readAllResultSchema = z.object({ updated: z.int().min(0) }).meta({ id: "NotificationReadAllResult" });
export type ReadAllDto = z.input<typeof readAllResultSchema>;
