import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { SchoolScope } from "@/lib/tenant/scope";
import { getClassSubjects } from "./class-subjects-service";
import { CLASS_SELECT, SUBJECT_SELECT, toClassDto, toSubjectDto, toTermDto, toYearDto, toYearSummary } from "./dto";
import { requireSchool } from "./guards";
import type { AcademicYearDto, ActiveTermDto, ClassDto, ClassSubjectsDto, ListClassesQuery, ListSubjectsQuery, SubjectDto } from "./schemas";

/** Query baca domain akademik (selalu ber-take; data per sekolah kecil). */
const MAX_YEARS = 100;
const MAX_CLASSES = 500;
const MAX_SUBJECTS = 500;

export async function listAcademicYears(scope: SchoolScope): Promise<AcademicYearDto[]> {
  const school = await requireSchool(prisma, scope);
  const rows = await prisma.academicYear.findMany({
    where: { schoolId: scope.schoolId },
    orderBy: { startDate: "desc" },
    include: { terms: true },
    take: MAX_YEARS,
  });
  return rows.map((row) => toYearDto(row, row.terms, school.activeTermId));
}

export async function getActiveTerm(scope: SchoolScope): Promise<ActiveTermDto> {
  const school = await requireSchool(prisma, scope);
  if (!school.activeTermId) return { term: null, academicYear: null };
  const term = await prisma.term.findFirst({
    where: { id: school.activeTermId, schoolId: scope.schoolId },
    include: { academicYear: true },
  });
  if (!term) return { term: null, academicYear: null };
  return { term: toTermDto(term, term.academicYear.name, school.activeTermId), academicYear: toYearSummary(term.academicYear) };
}

/** Tahun ajaran semester aktif (default filter kelas); null bila belum ada semester aktif. */
async function activeAcademicYearId(scope: SchoolScope, activeTermId: string | null): Promise<string | null> {
  if (!activeTermId) return null;
  const term = await prisma.term.findFirst({ where: { id: activeTermId, schoolId: scope.schoolId }, select: { academicYearId: true } });
  return term?.academicYearId ?? null;
}

export async function listClasses(scope: SchoolScope, query: ListClassesQuery): Promise<ClassDto[]> {
  const school = await requireSchool(prisma, scope);
  const academicYearId = query.academicYearId ?? (await activeAcademicYearId(scope, school.activeTermId));
  const where: Prisma.SchoolClassWhereInput = {
    schoolId: scope.schoolId,
    ...(academicYearId ? { academicYearId } : {}),
    ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    ...(query.gradeLevel === undefined ? {} : { gradeLevel: query.gradeLevel }),
  };
  const rows = await prisma.schoolClass.findMany({
    where,
    orderBy: [{ gradeLevel: "asc" }, { name: "asc" }],
    select: CLASS_SELECT,
    take: MAX_CLASSES,
  });
  return rows.map(toClassDto);
}

export function readClassSubjects(scope: SchoolScope, classId: string): Promise<ClassSubjectsDto> {
  return getClassSubjects(prisma, scope, classId);
}

export async function listSubjects(scope: SchoolScope, query: ListSubjectsQuery): Promise<SubjectDto[]> {
  await requireSchool(prisma, scope);
  const rows = await prisma.subject.findMany({
    where: { schoolId: scope.schoolId, ...(query.isActive === undefined ? {} : { isActive: query.isActive }) },
    orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
    select: SUBJECT_SELECT,
    take: MAX_SUBJECTS,
  });
  return rows.map(toSubjectDto);
}
