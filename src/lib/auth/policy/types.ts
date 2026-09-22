import type { SponsorStatus, StudentStatus, UserRole } from "@prisma/client";

/**
 * Aturan satu aksi. Default aman: aksi STUDENT hanya untuk status ACTIVE dan aksi SPONSOR
 * hanya untuk status APPROVED kecuali dinyatakan lain; saat mustChangePassword semua aksi
 * ditolak kecuali allowDuringPasswordChange; SUPER_ADMIN tanpa TOTP aktif ditolak kecuali
 * allowDuringTotpEnrollment.
 */
export interface PolicyRule {
  readonly roles: readonly UserRole[];
  readonly studentStatuses?: readonly StudentStatus[];
  readonly sponsorStatuses?: readonly SponsorStatus[];
  readonly allowDuringPasswordChange?: boolean;
  /** Tetap boleh bagi SUPER_ADMIN yang belum mengaktifkan TOTP (default: ditolak TOTP_ENROLLMENT_REQUIRED). */
  readonly allowDuringTotpEnrollment?: boolean;
}

export const ALL_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT"];
export const ALL_STUDENT_STATUSES: readonly StudentStatus[] = ["ACTIVE", "GRADUATED"];
export const ALL_SPONSOR_STATUSES: readonly SponsorStatus[] = ["PENDING", "APPROVED", "SUSPENDED"];
export const ADMINS: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN"];
