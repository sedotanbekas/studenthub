import type { Tx } from "@/lib/db";
import { PUSH_ERROR } from "@/lib/push/constants";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { reminderKey } from "./reminder-rules";

/**
 * Pengingat absen (N5) yang belum terkirim tidak relevan lagi setelah siswa absen: PENDING -> SKIPPED "OBSOLETE".
 * Dipanggil di transaksi check-in (Notification ditulis terakhir) dan sesudah pengingat ditulis (sapuan balapan).
 * Baris yang sudah terkirim tidak disentuh.
 */
export async function expireAttendanceReminders(tx: Tx, userIds: readonly string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  const { count } = await tx.notification.updateMany({
    where: { userId: { in: [...userIds] }, type: "ATTENDANCE_REMINDER", pushStatus: "PENDING" },
    data: { pushStatus: "SKIPPED", pushError: PUSH_ERROR.OBSOLETE },
  });
  return count;
}

/** Sapuan sesudah menulis pengingat: penerima yang ternyata sudah absen di tanggal itu (balapan dengan check-in). */
export async function sweepCheckedInReminders(tx: Tx, schoolId: string, date: LocalDate, recipientUserIds: readonly string[]): Promise<number> {
  if (recipientUserIds.length === 0) return 0;
  const rows = await tx.attendance.findMany({
    where: { schoolId, date: toDbDate(date), student: { userId: { in: [...recipientUserIds] } } },
    select: { student: { select: { userId: true } } },
  });
  if (rows.length === 0) return 0;
  const { count } = await tx.notification.updateMany({
    where: { userId: { in: rows.map((r) => r.student.userId) }, type: "ATTENDANCE_REMINDER", dedupKey: reminderKey(date), pushStatus: "PENDING" },
    data: { pushStatus: "SKIPPED", pushError: PUSH_ERROR.OBSOLETE },
  });
  return count;
}
