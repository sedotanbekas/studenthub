import type { Announcement, Notification, Prisma } from "@prisma/client";
import type { UnreadSummary } from "./inbox-filters";
import type { InboxAnnouncementDto, InboxDetailDto, InboxItemDto, UnreadCountDto } from "./schemas";

/** Pemetaan baris Prisma -> DTO inbox (murni). Instant sebagai ISO UTC. */
export type InboxRow = Pick<Notification, "id" | "type" | "category" | "title" | "body" | "data" | "announcementId" | "readAt" | "createdAt">;
export type InboxAnnouncementRow = Pick<Announcement, "id" | "category" | "title" | "body" | "publishedAt">;
export type InboxLinkData = { screen: string; id: string; count?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Hanya objek `{screen, id}` (+ `count` bulat) yang diteruskan ke klien; bentuk lain -> null. */
export function toLinkData(value: Prisma.JsonValue | null): InboxLinkData | null {
  if (!isRecord(value)) return null;
  const { screen, id, count } = value;
  if (typeof screen !== "string" || typeof id !== "string") return null;
  return Number.isInteger(count) ? { screen, id, count: count as number } : { screen, id };
}

export function toInboxItemDto(row: InboxRow): InboxItemDto {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    title: row.title,
    body: row.body,
    data: toLinkData(row.data),
    announcementId: row.announcementId,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAnnouncementDto(row: InboxAnnouncementRow): InboxAnnouncementDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    body: row.body,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

export function toInboxDetailDto(row: InboxRow, announcement: InboxAnnouncementRow | null): InboxDetailDto {
  return { ...toInboxItemDto(row), announcement: announcement ? toAnnouncementDto(announcement) : null };
}

export function toUnreadCountDto(summary: UnreadSummary): UnreadCountDto {
  return {
    total: summary.total,
    announcements: summary.announcements,
    personal: summary.personal,
    latestCreatedAt: summary.latestCreatedAt ? summary.latestCreatedAt.toISOString() : null,
  };
}
