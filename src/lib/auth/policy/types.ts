import type { SponsorStatus, StudentStatus, UserRole } from "@prisma/client";

/**
 * Aturan satu aksi. Default aman: aksi STUDENT hanya untuk status ACTIVE dan aksi SPONSOR
 * hanya untuk status APPROVED kecuali dinyatakan lain; saat mustChangePassword semua aksi
 * ditolak kecuali allowDuringPasswordChange.
 */
export interface PolicyRule {
  readonly roles: readonly UserRole[];
  readonly studentStatuses?: readonly StudentStatus[];
  readonly sponsorStatuses?: readonly SponsorStatus[];
  readonly allowDuringPasswordChange?: boolean;
}

export const ALL_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT"];
export const ALL_STUDENT_STATUSES: readonly StudentStatus[] = ["ACTIVE", "GRADUATED"];
export const ALL_SPONSOR_STATUSES: readonly SponsorStatus[] = ["PENDING", "APPROVED", "SUSPENDED"];
export const ADMINS: readonly UserRole[] = ["SUPER_ADMIN", "SCHOOL_ADMIN"];
