import { ADMINS, MONITORS, type PolicyRule } from "./types";

/** Aksi POLICY domain absensi (check-in, izin/sakit, monitoring, koreksi). */
export const attendancePolicy = {
  /** Siswa aktif: lihat status hari ini, precheck lokasi, check-in, isi/ubah alasan terlambat hari ini (A1). */
  "attendance.self": { roles: ["STUDENT"] },
  /** Riwayat & ringkasan milik sendiri (siswa lulus tetap boleh membaca). */
  "attendance.self.read": { roles: ["STUDENT"], studentStatuses: ["ACTIVE", "GRADUATED"] },
  /** Ajukan/batalkan izin atau sakit. */
  "leave.self": { roles: ["STUDENT"] },
  "leave.self.read": { roles: ["STUDENT"], studentStatuses: ["ACTIVE", "GRADUATED"] },
  /** Admin: monitoring harian, peta, rekap, analitik, anomali, percobaan ditolak. */
  "attendance.monitor": { roles: MONITORS },
  /** Admin: koreksi manual catatan absensi. */
  "attendance.correct": { roles: ADMINS },
  /** Admin (termasuk akun guru/wali kelas): tinjau anomali Valid/Tidak valid (B1). */
  "attendance.anomaly_review": { roles: ADMINS },
  /** Super admin: tutup ulang satu hari sekolah (auto-ALPHA manual) untuk hari lampau. */
  "attendance.reclose": { roles: ["SUPER_ADMIN"] },
  /** Super admin: mode uji absensi sementara (longgarkan lokasi & jam absen semua sekolah). */
  "attendance.test_mode": { roles: ["SUPER_ADMIN"], productionDisabled: true },
  /** Admin: tinjau (setujui/tolak) izin & sakit, input izin atas nama siswa. */
  "leave.review": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
