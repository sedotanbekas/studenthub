import type { NotificationCategory, NotificationType, Prisma } from "@prisma/client";
import { cursorWhere, type CursorPosition } from "@/lib/http/cursor";

/**
 * Pembangun filter inbox (murni, tanpa Prisma runtime) — desain N6–N8.
 * - kind=announcement -> type='ANNOUNCEMENT' (indeks [userId,type,createdAt]);
 * - kind=personal     -> type<>'ANNOUNCEMENT';
 * - kind=all          -> tanpa filter tipe (indeks [userId,createdAt]).
 * Semua potongan digabung lewat `AND` agar `OR` milik cursor tidak tertimpa.
 */
export const INBOX_KINDS = ["all", "announcement", "personal"] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];

type Where = Prisma.NotificationWhereInput;

export interface InboxFilter {
  readonly userId: string;
  readonly kind: InboxKind;
  readonly category?: NotificationCategory;
  readonly unreadOnly: boolean;
  readonly cursor: CursorPosition | null;
}

export interface ReadAllFilter {
  readonly userId: string;
  readonly kind: InboxKind;
  /** Batas atas createdAt (inklusif); hasil `readAllBound`. */
  readonly bound: Date;
}

export interface UnreadGroup {
  readonly type: NotificationType;
  readonly count: number;
  readonly latest: Date | null;
}

export interface UnreadSummary {
  readonly total: number;
  readonly announcements: number;
  readonly personal: number;
  readonly latestCreatedAt: Date | null;
}

const isNonEmpty = (where: Where): boolean => Object.keys(where).length > 0;

export function kindWhere(kind: InboxKind): Where {
  if (kind === "announcement") return { type: "ANNOUNCEMENT" };
  if (kind === "personal") return { type: { not: "ANNOUNCEMENT" } };
  return {};
}

/** Filter feed: milik pengguna + kind + kategori + belum dibaca + posisi cursor. */
export function buildInboxWhere(filter: InboxFilter): Where {
  const parts: Where[] = [
    { userId: filter.userId },
    kindWhere(filter.kind),
    filter.category ? { category: filter.category } : {},
    filter.unreadOnly ? { readAt: null } : {},
    cursorWhere(filter.cursor),
  ];
  return { AND: parts.filter(isNonEmpty) };
}

/**
 * Batas "tandai semua dibaca": `before` dari klien (saat daftar diambil) bila lebih awal dari now;
 * tidak pernah melewati now agar item yang datang belakangan tidak ikut ditandai.
 */
export function readAllBound(before: Date | undefined, now: Date): Date {
  return before !== undefined && before.getTime() < now.getTime() ? before : now;
}

export function buildReadAllWhere(filter: ReadAllFilter): Where {
  const parts: Where[] = [{ userId: filter.userId, readAt: null, createdAt: { lte: filter.bound } }, kindWhere(filter.kind)];
  return { AND: parts.filter(isNonEmpty) };
}

/** Ringkas hasil agregasi per tipe menjadi badge: total, pengumuman, personal, terbaru. */
export function summarizeUnread(groups: readonly UnreadGroup[]): UnreadSummary {
  return groups.reduce<UnreadSummary>(
    (acc, group) => {
      const isAnnouncement = group.type === "ANNOUNCEMENT";
      const latest = group.latest !== null && (acc.latestCreatedAt === null || group.latest > acc.latestCreatedAt) ? group.latest : acc.latestCreatedAt;
      return {
        total: acc.total + group.count,
        announcements: acc.announcements + (isAnnouncement ? group.count : 0),
        personal: acc.personal + (isAnnouncement ? 0 : group.count),
        latestCreatedAt: latest,
      };
    },
    { total: 0, announcements: 0, personal: 0, latestCreatedAt: null },
  );
}
