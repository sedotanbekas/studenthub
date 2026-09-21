import type { NotificationEvent } from "@/lib/notifications/notify";

/**
 * Notifikasi NISN_RELEASED untuk SUPER ADMIN (murni) setiap kali sekolah melepas NISN siswa LULUS di
 * sekolah lain. Hanya memuat sekolah PENGKLAIM + daftar NISN: tanpa id/nama siswa pemegang lama
 * maupun sekolah asalnya (detail ada di audit sekolah asal).
 */
export interface ReleaseNoticeInput {
  readonly claimer: { readonly id: string; readonly name: string };
  readonly nisns: readonly string[];
}

export const NOTICE_NISNS_SHOWN = 10;

export function nisnReleaseSuperAdminNotice(input: ReleaseNoticeInput): NotificationEvent {
  const count = input.nisns.length;
  const shown = input.nisns.slice(0, NOTICE_NISNS_SHOWN).join(", ");
  const more = count > NOTICE_NISNS_SHOWN ? ` dan ${count - NOTICE_NISNS_SHOWN} lainnya` : "";
  return {
    type: "NISN_RELEASED",
    title: count === 1 ? "NISN siswa lulus dilepas" : `${count} NISN siswa lulus dilepas`,
    body: `${input.claimer.name} mengaktifkan NISN milik siswa lulus di sekolah lain: ${shown}${more}. Akun lama pemegangnya dilepas dan sesinya dicabut.`,
    link: { screen: "school", id: input.claimer.id },
  };
}
