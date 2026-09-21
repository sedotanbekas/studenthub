import type { NotificationEvent } from "../notify";

/**
 * Teks notifikasi rapor (murni, Bahasa Indonesia). Tautan deep link: { screen: "report-card", id }.
 * Tidak memuat nilai (dibuka di aplikasi setelah login).
 */
const LINK_SCREEN = "report-card";

export interface ReportCardPublishedInfo {
  readonly reportCardId: string;
  readonly termLabel: string;
  /** true = rapor pernah terbit, ditarik, lalu diterbitkan lagi. */
  readonly republished: boolean;
}

export function reportCardPublishedNotification(info: ReportCardPublishedInfo): NotificationEvent {
  return {
    type: "REPORT_CARD_PUBLISHED",
    title: info.republished ? "Rapor diperbarui" : "Rapor terbit",
    body: info.republished
      ? `Rapor ${info.termLabel} Anda telah diperbarui oleh sekolah. Buka untuk melihat nilai terbaru.`
      : `Rapor ${info.termLabel} Anda sudah terbit. Buka untuk melihat nilai dan rekap kehadiran.`,
    link: { screen: LINK_SCREEN, id: info.reportCardId },
  };
}
