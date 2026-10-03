import { ADMIN_MUTABLE_CATEGORIES, normalizeMutedCategories, type AdminMutableCategory } from "@/lib/notifications/rules";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";

/** Aturan murni pilihan kabar sekolah per akun admin (N2): petunjuk, centang (= terima), kalimat ringkas. */

export const CATEGORY_HINTS: Readonly<Record<AdminMutableCategory, string>> = {
  FINANCE: "Bukti transfer SPP baru yang menunggu verifikasi.",
  STUDENT_AFFAIRS: "Pengajuan izin/sakit baru dari siswa.",
};

export const PREFS_FOOTNOTE =
  "Berlaku untuk notifikasi baru. Notifikasi pribadi dan kabar Sistem selalu dikirim; bila semua admin mematikan satu kategori, admin utama tetap menerimanya.";

export const categoryLabel = (category: AdminMutableCategory): string => ENUM_LABELS.NotificationCategory[category];

/** receive = dicentang (terima). Hasil selalu ternormalisasi & urut kanonik. */
export function toggleMuted(muted: readonly AdminMutableCategory[], category: AdminMutableCategory, receive: boolean): AdminMutableCategory[] {
  return normalizeMutedCategories(receive ? muted.filter((c) => c !== category) : [...muted, category]);
}

export function prefsSummary(muted: readonly AdminMutableCategory[]): string {
  const names = normalizeMutedCategories(muted).map(categoryLabel);
  if (names.length === 0) return "Semua kabar sekolah dikirim ke akun ini.";
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} dan ${names[names.length - 1]}`;
  return `Kabar ${list} tidak dikirim ke akun ini.`;
}

export const prefsSavedMessage = (muted: readonly AdminMutableCategory[]): string => `Tersimpan. ${prefsSummary(muted)}`;

export { ADMIN_MUTABLE_CATEGORIES };
