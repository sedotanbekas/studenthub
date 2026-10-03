import { reminderKey } from "@/lib/attendance/reminder-rules";
import { formatMinute } from "@/lib/time/zone";
import type { NotificationEvent } from "../notify";

/**
 * Pengingat absen (N5): push-only (baris langsung dibaca, tidak tampil di kotak masuk), kedaluwarsa di batas hadir
 * (jam masuk + toleransi), satu per siswa per tanggal (dedupKey). Klik membuka alur absen (`check-in` -> ?absen=1).
 */
export interface AttendanceReminderInfo {
  readonly date: string;
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
  readonly expiresAt: Date;
}

export function attendanceReminderEvent(info: AttendanceReminderInfo): NotificationEvent {
  return {
    type: "ATTENDANCE_REMINDER",
    title: "Kamu belum absen hari ini",
    body: `Jam masuk ${formatMinute(info.startMinute)}. Absen begitu tiba di sekolah, paling lambat ${formatMinute(info.startMinute + info.lateToleranceMinutes)} agar tercatat hadir.`,
    link: { screen: "check-in", id: info.date },
    dedupKey: reminderKey(info.date),
    pushExpiresAt: info.expiresAt,
  };
}
