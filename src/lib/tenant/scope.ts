import type { Principal } from "@/lib/auth/principal";
import { badRequest, forbidden } from "@/lib/http/errors";

declare const schoolScopeBrand: unique symbol;
declare const sponsorScopeBrand: unique symbol;

/**
 * Cakupan sekolah terverifikasi. Hanya bisa dibuat lewat resolveSchoolScope sehingga string
 * schoolId mentah dari request tidak bisa dipakai langsung untuk query data tenant.
 */
export type SchoolScope = { readonly schoolId: string; readonly [schoolScopeBrand]: true };
export type SponsorScope = { readonly sponsorId: string; readonly [sponsorScopeBrand]: true };

const brandSchool = (schoolId: string): SchoolScope => Object.freeze({ schoolId }) as SchoolScope;
const brandSponsor = (sponsorId: string): SponsorScope => Object.freeze({ sponsorId }) as SponsorScope;

/**
 * SCHOOL_ADMIN: selalu sekolahnya sendiri (schoolId lain di query -> 403 SCOPE_MISMATCH).
 * SUPER_ADMIN: wajib menyebut ?schoolId= (400 SCHOOL_ID_REQUIRED); keberadaan sekolah
 * diverifikasi service (404). Peran lain -> 403.
 */
export function resolveSchoolScope(principal: Principal, requestedSchoolId?: string | null): SchoolScope {
  const requested = requestedSchoolId?.trim() || null;
  if (principal.role === "SCHOOL_ADMIN") {
    if (!principal.schoolId) throw forbidden("FORBIDDEN", "Akun admin sekolah tidak terikat sekolah.");
    if (requested && requested !== principal.schoolId) {
      throw forbidden("SCOPE_MISMATCH", "Anda hanya dapat mengakses data sekolah Anda sendiri.");
    }
    return brandSchool(principal.schoolId);
  }
  if (principal.role === "SUPER_ADMIN") {
    if (!requested) throw badRequest("SCHOOL_ID_REQUIRED", "Parameter schoolId wajib diisi untuk super admin.");
    return brandSchool(requested);
  }
  throw forbidden("FORBIDDEN", "Anda tidak memiliki akses ke data sekolah.");
}

/** Siswa hanya bertindak atas dirinya sendiri; id tidak pernah diambil dari body. */
export function studentSelf(principal: Principal): { schoolId: string; studentId: string; userId: string } {
  if (principal.role !== "STUDENT" || !principal.studentId || !principal.schoolId) {
    throw forbidden("FORBIDDEN", "Aksi ini khusus siswa.");
  }
  return { schoolId: principal.schoolId, studentId: principal.studentId, userId: principal.userId };
}

/** SPONSOR: selalu sponsornya sendiri; SUPER_ADMIN wajib menyebut sponsorId. */
export function resolveSponsorScope(principal: Principal, requestedSponsorId?: string | null): SponsorScope {
  if (principal.role === "SPONSOR") {
    if (!principal.sponsorId) throw forbidden("FORBIDDEN", "Akun sponsor tidak terikat perusahaan.");
    return brandSponsor(principal.sponsorId);
  }
  if (principal.role === "SUPER_ADMIN") {
    const requested = requestedSponsorId?.trim() || null;
    if (!requested) throw badRequest("SPONSOR_ID_REQUIRED", "Parameter sponsorId wajib diisi untuk super admin.");
    return brandSponsor(requested);
  }
  throw forbidden("FORBIDDEN", "Anda tidak memiliki akses ke data sponsor.");
}
