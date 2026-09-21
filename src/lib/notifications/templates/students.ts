import type { NotificationEvent } from "../notify";

/**
 * Teks notifikasi domain siswa (murni, Bahasa Indonesia). Notifikasi NISN_RELEASED dikirim ke admin
 * sekolah ASAL; tidak memuat id/nama sekolah baru (tanpa id tenant lain).
 */
export interface ReleasedStudentInfo {
  readonly studentId: string;
  readonly name: string;
  readonly nisn: string;
}

export function nisnReleasedNotification(released: readonly ReleasedStudentInfo[]): NotificationEvent {
  const [first] = released;
  if (released.length === 1 && first !== undefined) {
    return {
      type: "NISN_RELEASED",
      title: "NISN siswa lulus dilepas",
      body: `NISN ${first.nisn} milik ${first.name} (Lulus) kini diaktifkan di sekolah lain. Akun lama siswa ini tidak dapat login lagi.`,
      link: { screen: "student", id: first.studentId },
    };
  }
  const names = released.slice(0, 5).map((r) => `${r.name} (${r.nisn})`).join(", ");
  const more = released.length > 5 ? ` dan ${released.length - 5} lainnya` : "";
  return {
    type: "NISN_RELEASED",
    title: `${released.length} NISN siswa lulus dilepas`,
    body: `NISN siswa lulus berikut kini diaktifkan di sekolah lain: ${names}${more}. Akun lama mereka tidak dapat login lagi.`,
  };
}
