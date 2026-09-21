import { fromDbDate } from "@/lib/time/zone";
import type { ActivationGap, ActivationInput } from "./activation-rules";
import type { SchoolContext, StudentRow } from "./records";
import type { StudentDetail } from "./schemas";

/** Pemetaan baris Prisma -> DTO/aturan murni (tanpa passwordHash/token; instant ISO; @db.Date "YYYY-MM-DD"). */
const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

export function activationInputOf(row: StudentRow, school: SchoolContext): ActivationInput {
  return {
    name: row.user.name,
    nisn: row.nisn,
    nis: row.nis,
    gender: row.gender,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate === null ? null : fromDbDate(row.birthDate),
    address: row.address,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    classId: row.currentClassId,
    class: row.currentClass,
    schoolId: school.id,
    schoolActive: school.isActive,
    timezone: school.timezone,
    activeAcademicYearId: school.activeAcademicYearId,
  };
}

export function toStudentDetail(row: StudentRow, gaps: readonly ActivationGap[]): StudentDetail {
  const klass = row.currentClass;
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.user.name,
    nisn: row.nisn,
    nis: row.nis,
    gender: row.gender,
    status: row.status,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate === null ? null : fromDbDate(row.birthDate),
    address: row.address,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    class: klass === null ? null : { id: klass.id, name: klass.name, isActive: klass.isActive, academicYearId: klass.academicYearId },
    sppAmount: row.sppAmount,
    hasActiveNisn: row.activeNisn !== null,
    activatedAt: iso(row.activatedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    user: {
      isActive: row.user.isActive,
      mustChangePassword: row.user.mustChangePassword,
      lastLoginAt: iso(row.user.lastLoginAt),
      tempPasswordExpiresAt: iso(row.user.tempPasswordExpiresAt),
    },
    activationGaps: gaps.map((g) => ({ field: g.field, code: g.code, message: g.message })),
  };
}

/** Snapshot biodata untuk audit (tanpa data rahasia). */
export function auditSnapshot(row: StudentRow): Record<string, unknown> {
  return {
    name: row.user.name,
    nisn: row.nisn,
    nis: row.nis,
    gender: row.gender,
    status: row.status,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate === null ? null : fromDbDate(row.birthDate),
    address: row.address,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    currentClassId: row.currentClassId,
    sppAmount: row.sppAmount,
  };
}
