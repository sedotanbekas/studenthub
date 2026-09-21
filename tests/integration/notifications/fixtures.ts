/**
 * Fixture bersama test inbox notifikasi: membuat notifikasi lewat JALUR TULIS RESMI
 * (notifyUsers di dalam withTx) dan pengumuman terbit sebagai induk notifikasi ANNOUNCEMENT.
 */
import type { NotificationCategory, NotificationType } from "@prisma/client";
import { notifyUsers } from "@/lib/notifications/notify";
import { withTx } from "@/lib/tx";
import { prisma, uniq } from "../helpers/db";

export interface InboxItemBody {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  title: string;
  body: string;
  data: { screen: string; id: string; count?: number } | null;
  announcementId: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface CursorMetaBody {
  limit: number;
  nextCursor: string | null;
  hasMore: boolean;
}

/** Instant tetap di masa lalu + offset detik (urutan createdAt deterministik per test). */
export function instantAt(base: Date, seconds: number): Date {
  return new Date(base.getTime() + seconds * 1000);
}

/** Satu notifikasi personal untuk satu pengguna pada instant `now`. Mengembalikan id barisnya. */
export async function notifyPersonal(
  userId: string,
  now: Date,
  options: { type?: NotificationType; title?: string } = {},
): Promise<string> {
  const type = options.type ?? "INVOICE_ISSUED";
  const title = options.title ?? `Personal ${uniq("t")}`;
  await withTx((tx) => notifyUsers(tx, [userId], { type, title, body: `Isi ${title}`, link: { screen: "invoice", id: uniq("inv") } }, { now }));
  const row = await prisma.notification.findFirstOrThrow({ where: { userId, title }, select: { id: true } });
  return row.id;
}

export interface AnnouncementFixture {
  readonly announcementId: string;
  readonly notificationId: string;
}

/** Pengumuman PUBLISHED + fan-out ke `userId` lewat notifyUsers. */
export async function notifyAnnouncement(
  schoolId: string,
  authorId: string,
  userId: string,
  now: Date,
  category: NotificationCategory = "EVENT",
): Promise<AnnouncementFixture> {
  const title = `Pengumuman ${uniq("a")}`;
  const announcement = await prisma.announcement.create({
    data: {
      schoolId,
      authorId,
      category,
      title,
      body: `Isi lengkap ${title}. Detail acara ada di sini.`,
      audience: "ALL",
      status: "PUBLISHED",
      publishedAt: now,
      recipientCount: 1,
    },
  });
  await withTx((tx) =>
    notifyUsers(
      tx,
      [userId],
      { type: "ANNOUNCEMENT", category, title, body: announcement.body, announcementId: announcement.id, link: { screen: "announcement", id: announcement.id } },
      { now },
    ),
  );
  const row = await prisma.notification.findFirstOrThrow({ where: { userId, announcementId: announcement.id }, select: { id: true } });
  return { announcementId: announcement.id, notificationId: row.id };
}
