import { LEAVE_MAX_BACKDATE_DAYS } from "@/lib/attendance/leave-constants";
import { earliestLeaveStart } from "@/lib/attendance/leave-rules";
import { parseLocalDate, type LocalDate } from "@/lib/time/zone";

/**
 * Tindakan langsung di kartu notifikasi (N4): Alpa -> ajukan izin/sakit untuk tanggal itu (selama masih dalam batas
 * mundur siswa), rekap harian -> buka kehadiran pada tanggal itu. Tujuan dibuka lewat intent URL (?ajukan=, ?tanggal=);
 * server tetap memeriksa batas & tumpang-tindih pengajuan.
 */
export type NotificationCta =
  | { readonly kind: "link"; readonly label: string; readonly href: string; readonly hint?: string }
  | { readonly kind: "note"; readonly text: string };

export const LEAVE_CTA_HINT = "Sudah mengajukan? Lihat di menu Izin & sakit.";
export const LEAVE_EXPIRED_NOTE = `Batas pengajuan izin sudah lewat (maks. ${LEAVE_MAX_BACKDATE_DAYS} hari ke belakang).`;

function linkOf(data: unknown): { readonly screen: string; readonly id: string } | null {
  if (typeof data !== "object" || data === null) return null;
  const { screen, id } = data as Record<string, unknown>;
  return typeof screen === "string" && typeof id === "string" ? { screen, id } : null;
}

function alphaCta(id: string, today: LocalDate): NotificationCta | null {
  const date = parseLocalDate(id);
  if (!date) return null;
  if (date < earliestLeaveStart(today, "STUDENT")) return { kind: "note", text: LEAVE_EXPIRED_NOTE };
  return { kind: "link", label: "Ajukan izin/sakit", href: `/hub/my-leave?ajukan=${date}`, hint: LEAVE_CTA_HINT };
}

export function notificationCta(row: { readonly type?: unknown; readonly data?: unknown }, today: LocalDate): NotificationCta | null {
  const link = linkOf(row.data);
  if (!link) return null;
  if (row.type === "ATTENDANCE_ALPHA" && link.screen === "attendance-alpha") return alphaCta(link.id, today);
  if (row.type === "ATTENDANCE_ALPHA" && link.screen === "leave-request") return { kind: "link", label: "Lihat pengajuan", href: "/hub/my-leave" };
  if (row.type === "ATTENDANCE_DAY_SUMMARY" && link.screen === "attendance-day") {
    const date = parseLocalDate(link.id);
    return date ? { kind: "link", label: "Buka kehadiran", href: `/hub/attendance?tanggal=${date}` } : null;
  }
  return null;
}

/** Tanggal dari query string (?ajukan=, ?tanggal=); selain tanggal kalender sah -> null. */
export function searchDate(search: string, key: string): LocalDate | null {
  const value = new URLSearchParams(search).get(key);
  return value ? parseLocalDate(value) : null;
}
