import type { SponsorStatus, StudentStatus, UserRole } from "@prisma/client";

/**
 * Aturan satu aksi. Default aman: aksi STUDENT hanya untuk status ACTIVE dan aksi SPONSOR
 * hanya untuk status APPROVED kecuali dinyatakan lain; saat mustChangePassword semua aksi
 * ditolak kecuali allowDuringPasswordChange; SUPER_ADMIN tanpa TOTP aktif ditolak kecuali
 * allowDuringTotpEnrollment; primarySchoolAdminOnly menolak admin sekolah selain admin UTAMA (PRIMARY_ADMIN_ONLY).
 */
export interface PolicyRule {
  readonly roles: readonly UserRole[];
  readonly studentStatuses?: readonly StudentStatus[];
  readonly sponsorStatuses?: readonly SponsorStatus[];
  readonly allowDuringPasswordChange?: boolean;
  /** Tetap boleh bagi SUPER_ADMIN yang belum mengaktifkan TOTP (default: ditolak TOTP_ENROLLMENT_REQUIRED). */
  readonly allowDuringTotpEnrollment?: boolean;
  /** SCHOOL_ADMIN wajib admin utama sekolahnya (Principal.isPrimarySchoolAdmin); peran lain tidak terpengaruh. */
  readonly primarySchoolAdminOnly?: boolean;
  /** Keamanan akun milik pemiliknya: ditolak IMPERSONATION_FORBIDDEN pada sesi "Masuk sebagai" super admin. */
  readonly blockedWhenImpersonating?: boolean;
  /** Pengecualian mode lihat "Masuk sebagai": perubahan (non-GET) aksi ini tetap boleh (hanya keluar/akhiri). */
  readonly allowWhenImpersonating?: boolean;
  /** Tidak tersedia di server produksi (siapa pun ditolak FORBIDDEN), mis. mode uji absensi -- pemilik 2026-10-07: siap produksi. */
  readonly productionDisabled?: boolean;
}

export const ALL_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT", "REGION_ADMIN"];
export const ALL_STUDENT_STATUSES: readonly StudentStatus[] = ["ACTIVE", "GRADUATED"];
export const ALL_SPONSOR_STATUSES: readonly SponsorStatus[] = ["PENDING", "APPROVED", "SUSPENDED"];
export const ADMINS: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN"];
/**
 * Pemantau data sekolah (BACA saja): admin + Admin Pemda (REGION_ADMIN, 2026-10-07) untuk sekolah di wilayahnya
 * (resolveSchoolScope). Hanya untuk aksi yang semua operasinya membaca; aksi ubah tetap ADMINS.
 */
export const MONITORS: readonly UserRole[] = [...ADMINS, "REGION_ADMIN"];
