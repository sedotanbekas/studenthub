import { attendanceLockKey, classLockKey, nisnReleaseLockKey } from "@/lib/lock-keys";

/**
 * Rencana kunci aplikasi mutasi siswa (murni). Urutan WAJIB sesuai src/lib/lock-keys.ts:
 * kelas (id naik, unik) -> kuota pelepasan NISN sekolah pengklaim -> absensi siswa. Diambil PALING AWAL di transaksi,
 * sebelum membaca apa pun dan sebelum Student FOR UPDATE (urutan kunci global src/lib/tx.ts).
 */
export interface StudentWriteLocks {
  /** Kelas yang akan ditempati siswa (aktivasi / penempatan / impor); null/undefined diabaikan. */
  readonly classIds?: ReadonlyArray<string | null | undefined>;
  /** Sekolah yang mengklaim NISN (dapat melepas NISN siswa LULUS di sekolah lain). */
  readonly claimingSchoolId?: string | null;
  /**
   * Siswa yang baris absensinya ikut diubah (keluar dari ACTIVE -> hapus baris turunan mendatang; ganti kelas
   * -> snapshot kelas baris izin mendatang). Sama dengan kunci penulis absensi (check-in, izin, koreksi).
   */
  readonly attendanceStudentId?: string | null;
}

export function studentLockKeys(locks: StudentWriteLocks): string[] {
  const classIds = [...new Set((locks.classIds ?? []).filter((id): id is string => typeof id === "string" && id.length > 0))].sort();
  const release = locks.claimingSchoolId ? [nisnReleaseLockKey(locks.claimingSchoolId)] : [];
  const attendance = locks.attendanceStudentId ? [attendanceLockKey(locks.attendanceStudentId)] : [];
  return [...classIds.map(classLockKey), ...release, ...attendance];
}
