import type { AttendanceStatus, UserRole } from "@prisma/client";
import type { NotificationEvent } from "../notify";

/**
 * Teks notifikasi koreksi absensi oleh admin (murni, Bahasa Indonesia). Dikirim ke siswa (push).
 * Tautan deep link: { screen: "attendance", id: <attendanceId> }.
 */
const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;
/** Indeks getUTCDay(): Minggu = 0. */
const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"] as const;

const STATUS_LABEL: Readonly<Record<AttendanceStatus, string>> = {
  HADIR: "Hadir",
  TERLAMBAT: "Terlambat",
  IZIN: "Izin",
  SAKIT: "Sakit",
  ALPHA: "Alpha",
};

/** "2026-09-21" -> "Senin, 21 September 2026". */
export function formatIndonesianDate(date: string): string {
  const instant = new Date(`${date}T00:00:00.000Z`);
  const weekday = WEEKDAYS[instant.getUTCDay()] ?? "";
  const month = MONTHS[instant.getUTCMonth()] ?? "";
  return `${weekday}, ${instant.getUTCDate()} ${month} ${instant.getUTCFullYear()}`;
}

export interface AttendanceCorrectedInfo {
  readonly attendanceId: string;
  readonly date: string;
  readonly status: AttendanceStatus;
  readonly lateMinutes: number | null;
  readonly reason: string;
  /** Peran pengoreksi: menentukan penyebut di teks (admin sekolah / super admin). */
  readonly actorRole: UserRole;
}

const ACTOR_LABEL: Partial<Readonly<Record<UserRole, string>>> = { SCHOOL_ADMIN: "admin sekolah", SUPER_ADMIN: "super admin" };

function statusText(status: AttendanceStatus, lateMinutes: number | null): string {
  const label = STATUS_LABEL[status];
  return status === "TERLAMBAT" && lateMinutes !== null ? `${label} (${lateMinutes} menit)` : label;
}

export function attendanceCorrectedNotification(info: AttendanceCorrectedInfo): NotificationEvent {
  return {
    type: "ATTENDANCE_CORRECTED",
    title: "Absensi Anda dikoreksi",
    body: `Absensi ${formatIndonesianDate(info.date)} diubah menjadi ${statusText(info.status, info.lateMinutes)} oleh ${ACTOR_LABEL[info.actorRole] ?? "admin"}. Alasan: ${info.reason}`,
    link: { screen: "attendance", id: info.attendanceId },
  };
}
