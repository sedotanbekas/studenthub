import type { Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import type { SchoolTz } from "@/lib/time/zone";
import type { ActivationClass } from "./activation-rules";

/**
 * Akses baris domain siswa yang SELALU melalui SchoolScope: lookup by id = findFirst({ id, schoolId }),
 * id milik sekolah lain -> 404. Dipakai bersama oleh query & service.
 */
export interface SchoolContext {
  readonly id: string;
  readonly name: string;
  readonly timezone: SchoolTz;
  readonly isActive: boolean;
  /** Tahun ajaran milik semester aktif; null bila sekolah belum menetapkan semester aktif. */
  readonly activeAcademicYearId: string | null;
}

export interface ClassRef extends ActivationClass {
  readonly name: string;
}

export function scopeFor(ctx: ActionContext, requestedSchoolId?: string): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), requestedSchoolId);
}

/** Sekolah dalam cakupan; SUPER_ADMIN dengan schoolId tak dikenal -> 404. */
export async function loadSchoolContext(db: Tx, scope: SchoolScope): Promise<SchoolContext> {
  const school = await db.school.findUnique({
    where: { id: scope.schoolId },
    select: { id: true, name: true, timezone: true, isActive: true, activeTerm: { select: { academicYearId: true } } },
  });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  return {
    id: school.id,
    name: school.name,
    timezone: school.timezone,
    isActive: school.isActive,
    activeAcademicYearId: school.activeTerm?.academicYearId ?? null,
  };
}

const classSelect = { id: true, name: true, schoolId: true, isActive: true, academicYearId: true } as const;

/** Kelas milik sekolah dalam cakupan; kelas sekolah lain / tidak ada -> 404 CLASS_NOT_FOUND. */
export async function findClassInSchool(db: Tx, scope: SchoolScope, classId: string): Promise<ClassRef> {
  const klass = await db.schoolClass.findFirst({ where: { id: classId, schoolId: scope.schoolId }, select: classSelect });
  if (!klass) throw notFound("Kelas tidak ditemukan.", "CLASS_NOT_FOUND");
  return klass;
}

export const studentRowSelect = {
  id: true,
  schoolId: true,
  userId: true,
  nisn: true,
  activeNisn: true,
  nis: true,
  gender: true,
  birthPlace: true,
  birthDate: true,
  address: true,
  guardianName: true,
  guardianPhone: true,
  status: true,
  currentClassId: true,
  activatedAt: true,
  sppAmount: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true, isActive: true, mustChangePassword: true, lastLoginAt: true, tempPasswordExpiresAt: true } },
  currentClass: { select: classSelect },
} satisfies Prisma.StudentSelect;

export type StudentRow = Prisma.StudentGetPayload<{ select: typeof studentRowSelect }>;

export async function findStudentRow(db: Tx, scope: SchoolScope, id: string): Promise<StudentRow> {
  const row = await db.student.findFirst({ where: { id, schoolId: scope.schoolId }, select: studentRowSelect });
  if (!row) throw notFound("Siswa tidak ditemukan.");
  return row;
}

/** Kunci baris siswa (FOR UPDATE) dalam cakupan sekolah; tidak ada / sekolah lain -> 404. */
export async function lockStudentRow(tx: Tx, scope: SchoolScope, id: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Student\` WHERE \`id\` = ${id} AND \`schoolId\` = ${scope.schoolId} FOR UPDATE`;
  if (rows.length === 0) throw notFound("Siswa tidak ditemukan.");
}
