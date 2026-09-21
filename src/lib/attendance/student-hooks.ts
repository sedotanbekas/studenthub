import type { Tx } from "@/lib/db";
import { toDbDate, type LocalDate } from "@/lib/time/zone";

/**
 * Kait absensi yang dipanggil domain siswa DI DALAM transaksi perubahan status / kelas. Pemanggil WAJIB
 * sudah memegang kunci `attendance:<studentId>` (lock-plan attendanceStudentId) lalu Student FOR UPDATE.
 *
 * Satu-satunya baris absensi di MASA DEPAN adalah LEAVE hasil materialisasi izin (D10); auto-ALPHA hanya
 * menulis hari yang sudah ditutup. Baris itu mengikuti keadaan siswa saat izin disetujui, jadi:
 * - siswa keluar dari ACTIVE (INACTIVE/MOVED/GRADUATED): baris turunan mendatang dihapus agar analitik
 *   (D18: satu baris per siswa wajib absen per hari tertutup) tidak menghitung siswa yang sudah pergi.
 *   Izin tetap APPROVED; bila siswa diaktifkan lagi, penutupan hari (D17) membuat ulang baris LEAVE.
 * - siswa pindah kelas: snapshot kelas baris LEAVE mendatang diperbarui ke kelas baru.
 */
export interface FutureAttendanceTarget {
  readonly schoolId: string;
  readonly studentId: string;
  /** Tanggal lokal sekolah hari ini; hanya tanggal SETELAHNYA yang disentuh. */
  readonly todayLocal: LocalDate;
}

const DERIVED_SOURCES = ["LEAVE", "AUTO_ALPHA"] as const;

export async function removeFutureDerivedAttendance(tx: Tx, target: FutureAttendanceTarget): Promise<number> {
  const { count } = await tx.attendance.deleteMany({
    where: { schoolId: target.schoolId, studentId: target.studentId, date: { gt: toDbDate(target.todayLocal) }, source: { in: [...DERIVED_SOURCES] } },
  });
  return count;
}

export async function moveFutureLeaveRowsToClass(tx: Tx, target: FutureAttendanceTarget, classId: string | null): Promise<number> {
  const { count } = await tx.attendance.updateMany({
    where: { schoolId: target.schoolId, studentId: target.studentId, date: { gt: toDbDate(target.todayLocal) }, source: "LEAVE" },
    data: { classId },
  });
  return count;
}
