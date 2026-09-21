import type { NotificationCategory } from "@prisma/client";
import type { NotificationEvent } from "../notify";

/**
 * Notifikasi pengumuman terbit (murni). Judul = judul pengumuman; isi dipotong jadi pratinjau oleh
 * notify (teks polos). Isi lengkap dibaca lewat GET /notifications/{id}. Deep link { screen: "announcement", id }.
 * Idempoten per penerima lewat @@unique([userId, announcementId]).
 */
export interface AnnouncementNotice {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
}

export const ANNOUNCEMENT_SCREEN = "announcement";

export function announcementPublishedNotification(notice: AnnouncementNotice): NotificationEvent {
  return {
    type: "ANNOUNCEMENT",
    category: notice.category,
    title: notice.title,
    body: notice.body,
    link: { screen: ANNOUNCEMENT_SCREEN, id: notice.id },
    announcementId: notice.id,
  };
}
