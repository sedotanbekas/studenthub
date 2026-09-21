import type { SchoolTimezone } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import type { RuleViolation } from "@/lib/calendar/ranges";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { localParts, type LocalDate } from "@/lib/time/zone";
import { lockKey } from "@/lib/tx";

/** Baris sekolah minimal yang dibutuhkan domain akademik & kalender. */
export interface ScopedSchool {
  readonly id: string;
  readonly timezone: SchoolTimezone;
  readonly activeTermId: string | null;
  readonly schoolDaysMask: number;
}

/** Cakupan sekolah dari principal + ?schoolId (403/400 ditangani resolveSchoolScope). */
export function schoolScopeOf(ctx: ActionContext, schoolId: string | undefined): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), schoolId);
}

/** Sekolah dalam cakupan wajib ada (SUPER_ADMIN bisa menyebut schoolId sembarang) -> 404. */
export async function requireSchool(db: Tx, scope: SchoolScope): Promise<ScopedSchool> {
  const school = await db.school.findUnique({
    where: { id: scope.schoolId },
    select: { id: true, timezone: true, activeTermId: true, schoolDaysMask: true },
  });
  if (!school) throw notFound("Sekolah tidak ditemukan.");
  return school;
}

export const schoolToday = (school: Pick<ScopedSchool, "timezone">, now: Date): LocalDate => localParts(now, school.timezone).ymd;

/** Pelanggaran aturan murni -> 422 (default) atau 409. */
export function assertNoViolation(violation: RuleViolation | null, status: 409 | 422 = 422): void {
  if (!violation) return;
  throw status === 409 ? conflict(violation.code, violation.message) : unprocessable(violation.code, violation.message);
}

/** Kunci aplikasi untuk mutasi tahun ajaran/semester/semester aktif satu sekolah. */
export const academicLockKey = (schoolId: string): string => `academic:${schoolId}`;

/** Ambil kunci `academic:<schoolId>` (AppLock, urutan kunci global pertama) lalu baca sekolahnya. */
export async function lockAcademicScope(tx: Tx, scope: SchoolScope): Promise<ScopedSchool> {
  await lockKey(tx, academicLockKey(scope.schoolId));
  return requireSchool(tx, scope);
}
