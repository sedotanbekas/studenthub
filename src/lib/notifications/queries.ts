import type { Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { decodeOptionalCursor, sliceCursorPage } from "@/lib/http/cursor";
import type { CursorMeta } from "@/lib/http/envelope";
import { notFound } from "@/lib/http/errors";
import { toInboxDetailDto, toInboxItemDto, toUnreadCountDto } from "./dto";
import { buildInboxWhere, summarizeUnread } from "./inbox-filters";
import type { InboxDetailDto, InboxItemDto, ListInboxQuery, UnreadCountDto } from "./schemas";

/** Baca inbox milik pemanggil (desain N6, N7, N9). Selalu difilter userId dari sesi. */
export const NOTIFICATION_NOT_FOUND = "Notifikasi tidak ditemukan.";

const INBOX_SELECT = {
  id: true,
  type: true,
  category: true,
  title: true,
  body: true,
  data: true,
  announcementId: true,
  readAt: true,
  createdAt: true,
} as const satisfies Prisma.NotificationSelect;

const ANNOUNCEMENT_SELECT = {
  id: true,
  category: true,
  title: true,
  body: true,
  status: true,
  publishedAt: true,
} as const satisfies Prisma.AnnouncementSelect;

export interface InboxPage {
  readonly items: InboxItemDto[];
  readonly meta: CursorMeta;
}

/** Feed cursor: urut createdAt desc, id desc; ambil limit + 1 untuk menentukan hasMore. */
export async function listInbox(query: ListInboxQuery, ctx: ActionContext): Promise<InboxPage> {
  const { userId } = requirePrincipal(ctx);
  const cursor = decodeOptionalCursor(query.cursor);
  const rows = await prisma.notification.findMany({
    where: buildInboxWhere({ userId, kind: query.kind, category: query.category, unreadOnly: query.unreadOnly, cursor }),
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    select: INBOX_SELECT,
  });
  const page = sliceCursorPage(rows, query.limit);
  return { items: page.items.map(toInboxItemDto), meta: { limit: query.limit, nextCursor: page.nextCursor, hasMore: page.hasMore } };
}

/** Badge: satu agregasi atas indeks [userId, readAt], dikelompokkan per tipe lalu diringkas. */
export async function unreadCounts(ctx: ActionContext): Promise<UnreadCountDto> {
  const { userId } = requirePrincipal(ctx);
  const groups = await prisma.notification.groupBy({
    by: ["type"],
    where: { userId, readAt: null },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const summary = summarizeUnread(groups.map((g) => ({ type: g.type, count: g._count._all, latest: g._max.createdAt })));
  return toUnreadCountDto(summary);
}

/**
 * Detail milik pemanggil (tidak menandai dibaca). Milik orang lain / tidak ada / pengumuman
 * yang sudah ditarik (CANCELLED) -> 404 yang sama.
 */
export async function getInboxItem(id: string, ctx: ActionContext): Promise<InboxDetailDto> {
  const { userId } = requirePrincipal(ctx);
  const row = await prisma.notification.findFirst({
    where: { id, userId },
    select: { ...INBOX_SELECT, announcement: { select: ANNOUNCEMENT_SELECT } },
  });
  if (!row || row.announcement?.status === "CANCELLED") throw notFound(NOTIFICATION_NOT_FOUND);
  return toInboxDetailDto(row, row.announcement);
}
