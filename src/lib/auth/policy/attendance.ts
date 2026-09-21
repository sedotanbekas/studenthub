import { ADMINS, type PolicyRule } from "./types";

/** Aksi POLICY domain absensi (check-in, izin/sakit, monitoring, koreksi). */
export const attendancePolicy = {
  /** Siswa aktif: lihat status hari ini, precheck lokasi, check-in. */
  "attendance.self": { roles: ["STUDENT"] },
  /** Riwayat & ringkasan milik sendiri (siswa lulus tetap boleh membaca). */
  "attendance.self.read": { roles: ["STUDENT"], studentStatuses: ["ACTIVE", "GRADUATED"] },
  /** Ajukan/batalkan izin atau sakit. */
  "leave.self": { roles: ["STUDENT"] },
  "leave.self.read": { roles: ["STUDENT"], studentStatuses: ["ACTIVE", "GRADUATED"] },
  /** Admin: monitoring harian, peta, rekap, analitik, anomali, percobaan ditolak. */
  "attendance.monitor": { roles: ADMINS },
  /** Admin: koreksi manual catatan absensi. */
  "attendance.correct": { roles: ADMINS },
  /** Admin: tinjau (setujui/tolak) izin & sakit, input izin atas nama siswa. */
  "leave.review": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
