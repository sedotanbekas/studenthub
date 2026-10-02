import { ADMINS, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain pengguna & log audit. Akun staf dikelola SUPER_ADMIN; log audit sekolah
 * dapat dibaca admin sekolah (dipaksa ke sekolahnya sendiri oleh resolveSchoolScope).
 */
export const usersPolicy = {
  "users.manage": { roles: ["SUPER_ADMIN"] },
  "audit.platform.read": { roles: ["SUPER_ADMIN"] },
  /** Riwayat masuk super admin (perangkat, IP, perkiraan lokasi) — pengganti pembeda TOTP sejak 2026-10-02. */
  "audit.login.read": { roles: ["SUPER_ADMIN"] },
  "audit.school.read": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
