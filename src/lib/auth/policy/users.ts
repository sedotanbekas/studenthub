import { ADMINS, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain pengguna & log audit. Akun staf dikelola SUPER_ADMIN; log audit sekolah
 * dapat dibaca admin sekolah (dipaksa ke sekolahnya sendiri oleh resolveSchoolScope).
 */
export const usersPolicy = {
  "users.manage": { roles: ["SUPER_ADMIN"] },
  /** "Masuk sebagai" akun lain selain super admin (2026-10-05): verifikasi keluhan tanpa kata sandi pemilik akun. */
  "users.impersonate": { roles: ["SUPER_ADMIN"] },
  "audit.platform.read": { roles: ["SUPER_ADMIN"] },
  /** Riwayat masuk super admin (perangkat, IP, perkiraan lokasi) — pengganti pembeda TOTP sejak 2026-10-02. */
  "audit.login.read": { roles: ["SUPER_ADMIN"] },
  "audit.school.read": { roles: ADMINS },
  /** Akun admin sekolah (guru/wali kelas, 2026-10-02): semua admin sekolah melihat, hanya admin utama mengelola. */
  "schoolAdmins.read": { roles: ADMINS },
  "schoolAdmins.manage": { roles: ADMINS, primarySchoolAdminOnly: true },
  /**
   * Peran akses RBAC (2026-10-07). Membaca: super admin semua peran; admin sekolah hanya peran berbasis admin
   * sekolah (untuk memasang peran ke guru). Mengelola (buat/ubah/hapus peran, pasang ke akun mana pun): super admin.
   */
  "roles.read": { roles: ADMINS },
  "roles.manage": { roles: ["SUPER_ADMIN"], blockedWhenImpersonating: true },
} as const satisfies Record<string, PolicyRule>;
