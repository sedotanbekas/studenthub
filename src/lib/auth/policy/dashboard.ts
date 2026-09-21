import { ADMINS, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain dashboard. Ringkasan kartu dashboard admin sekolah (sekolahnya sendiri) dan super
 * admin (wajib ?schoolId=); peran lain ditolak FORBIDDEN.
 */
export const dashboardPolicy = {
  /** Ringkasan siswa, kehadiran hari ini, rapor semester, dan SPP. */
  "dashboard.read": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
