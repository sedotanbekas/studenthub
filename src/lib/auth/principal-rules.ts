import type { ClientPlatform, SponsorStatus, StudentStatus, UserRole } from "@prisma/client";
import type { Principal } from "./principal";
import { requiresTotpEnrollment } from "./totp-rules";

/** Bentuk baris sesi yang dimuat getAuth (satu query per request). */
export interface SessionRow {
  id: string;
  userId: string;
  platform: ClientPlatform;
  deviceId: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
  user: {
    id: string;
    role: UserRole;
    name: string;
    isActive: boolean;
    mustChangePassword: boolean;
    totpEnabledAt: Date | null;
    schoolId: string | null;
    sponsorId: string | null;
    school: { isActive: boolean } | null;
    student: { id: string; status: StudentStatus } | null;
    sponsor: { status: SponsorStatus } | null;
  };
}

export type IneligibleReason = "USER_INACTIVE" | "SCHOOL_INACTIVE" | "STUDENT_DRAFT" | "STUDENT_INACTIVE" | "STUDENT_MOVED";

export type EligibilityInput = {
  isActive: boolean;
  role: UserRole;
  schoolActive: boolean | null;
  studentStatus: StudentStatus | null;
};

/** Boleh login/memakai sesi? Siswa hanya ACTIVE atau GRADUATED (read-only). */
export function checkLoginEligibility(input: EligibilityInput): { ok: true } | { ok: false; reason: IneligibleReason } {
  if (!input.isActive) return { ok: false, reason: "USER_INACTIVE" };
  if (input.schoolActive === false) return { ok: false, reason: "SCHOOL_INACTIVE" };
  if (input.role === "STUDENT") {
    if (input.studentStatus === "DRAFT") return { ok: false, reason: "STUDENT_DRAFT" };
    if (input.studentStatus === "MOVED") return { ok: false, reason: "STUDENT_MOVED" };
    if (input.studentStatus !== "ACTIVE" && input.studentStatus !== "GRADUATED") return { ok: false, reason: "STUDENT_INACTIVE" };
  }
  return { ok: true };
}

export type PrincipalFailure = { ok: false; code: "SESSION_INVALID" | "ACCOUNT_INACTIVE" };

/** Evaluasi murni: sesi hidup + akun layak -> Principal beku. */
export function evaluatePrincipal(
  row: SessionRow | null,
  claims: { sub: string; sid: string },
  now: Date,
): { ok: true; principal: Principal } | PrincipalFailure {
  if (!row || row.revokedAt !== null || row.expiresAt.getTime() <= now.getTime() || row.userId !== claims.sub) {
    return { ok: false, code: "SESSION_INVALID" };
  }
  const { user } = row;
  const eligible = checkLoginEligibility({
    isActive: user.isActive,
    role: user.role,
    schoolActive: user.school ? user.school.isActive : null,
    studentStatus: user.student?.status ?? null,
  });
  if (!eligible.ok) return { ok: false, code: "ACCOUNT_INACTIVE" };
  const principal: Principal = Object.freeze({
    userId: user.id,
    sessionId: row.id,
    role: user.role,
    name: user.name,
    schoolId: user.schoolId,
    sponsorId: user.sponsorId,
    studentId: user.student?.id ?? null,
    studentStatus: user.student?.status ?? null,
    sponsorStatus: user.sponsor?.status ?? null,
    mustChangePassword: user.mustChangePassword,
    totpEnrollmentRequired: requiresTotpEnrollment(user.role, user.totpEnabledAt),
    platform: row.platform,
    deviceId: row.deviceId,
  });
  return { ok: true, principal };
}
