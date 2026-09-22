import type { ClientPlatform, SchoolTimezone, SponsorStatus, StudentStatus, UserRole } from "@prisma/client";
import type { AuthTokens, MeDto, SessionItem } from "./auth-schemas";
import { requiresTotpEnrollment } from "./totp-rules";

/** Pemetaan baris Prisma -> DTO respons auth (tanpa hash/token mentah dari DB). */

export interface IssuedSession {
  readonly sessionId: string;
  /** Token opak mentah — hanya ada di memori saat diterbitkan, DB menyimpan hash-nya. */
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: Date;
}

export interface TokenOwner {
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
  readonly schoolId: string | null;
  readonly sponsorId: string | null;
  readonly mustChangePassword: boolean;
}

export function toAuthTokens(access: { token: string; expiresAt: Date }, session: IssuedSession, owner: TokenOwner): AuthTokens {
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
    sessionId: session.sessionId,
    user: { id: owner.id, name: owner.name, role: owner.role, schoolId: owner.schoolId, sponsorId: owner.sponsorId },
    mustChangePassword: owner.mustChangePassword,
  };
}

export interface SessionRowForList {
  readonly id: string;
  readonly platform: ClientPlatform;
  readonly deviceName: string | null;
  readonly ipAddress: string | null;
  readonly lastUsedAt: Date;
  readonly createdAt: Date;
}

export function toSessionItem(row: SessionRowForList, currentSessionId: string): SessionItem {
  return {
    id: row.id,
    platform: row.platform,
    deviceName: row.deviceName,
    ipAddress: row.ipAddress,
    lastUsedAt: row.lastUsedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    isCurrent: row.id === currentSessionId,
  };
}

export interface MeRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly role: UserRole;
  readonly mustChangePassword: boolean;
  readonly lastLoginAt: Date | null;
  readonly totpEnabledAt: Date | null;
  readonly school: { readonly id: string; readonly name: string; readonly timezone: SchoolTimezone } | null;
  readonly student: {
    readonly id: string;
    readonly nisn: string;
    readonly nis: string;
    readonly status: StudentStatus;
    readonly currentClass: { readonly name: string } | null;
  } | null;
  readonly sponsor: { readonly id: string; readonly companyName: string; readonly status: SponsorStatus } | null;
}

export function toMe(row: MeRow, permissions: readonly string[]): MeDto {
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      mustChangePassword: row.mustChangePassword,
      totpEnabled: row.totpEnabledAt !== null,
      totpEnrollmentRequired: requiresTotpEnrollment(row.role, row.totpEnabledAt),
      lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    },
    school: row.school ? { id: row.school.id, name: row.school.name, timezone: row.school.timezone } : null,
    student: row.student
      ? {
          id: row.student.id,
          nisn: row.student.nisn,
          nis: row.student.nis,
          status: row.student.status,
          className: row.student.currentClass?.name ?? null,
        }
      : null,
    sponsor: row.sponsor ? { id: row.sponsor.id, companyName: row.sponsor.companyName, status: row.sponsor.status } : null,
    permissions: [...permissions],
  };
}
