import type { Semester } from "@prisma/client";
import { fromDbDate } from "@/lib/time/zone";
import type { DateRange } from "@/lib/calendar/ranges";
import { termLabel, type TermInput } from "./rules";
import type { AcademicYearDto, AcademicYearSummaryDto, ClassDto, ClassSubjectItemDto, SubjectDto, TermDto } from "./schemas";

/** Pemetaan baris Prisma -> DTO respons (tanpa kolom internal). */
export interface TermRow {
  readonly id: string;
  readonly academicYearId: string;
  readonly semester: Semester;
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface YearRow {
  readonly id: string;
  readonly name: string;
  readonly startDate: Date;
  readonly endDate: Date;
}

export interface ClassRow {
  readonly id: string;
  readonly academicYearId: string;
  readonly name: string;
  readonly gradeLevel: number;
  readonly isActive: boolean;
  readonly academicYear: { readonly name: string };
  readonly _count: { readonly students: number; readonly classSubjects: number };
}

export interface SubjectRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kkm: number;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export const dbRange = (row: { startDate: Date; endDate: Date }): DateRange => ({
  startDate: fromDbDate(row.startDate),
  endDate: fromDbDate(row.endDate),
});

export const toTermInput = (row: TermRow): TermInput => ({ semester: row.semester, ...dbRange(row) });

export function toTermDto(row: TermRow, yearName: string, activeTermId: string | null): TermDto {
  return {
    id: row.id,
    academicYearId: row.academicYearId,
    semester: row.semester,
    label: termLabel(row.semester, yearName),
    ...dbRange(row),
    isActive: row.id === activeTermId,
  };
}

export const toYearSummary = (row: YearRow): AcademicYearSummaryDto => ({ id: row.id, name: row.name, ...dbRange(row) });

export function toYearDto(row: YearRow, terms: readonly TermRow[], activeTermId: string | null): AcademicYearDto {
  const sorted = [...terms].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  return { ...toYearSummary(row), terms: sorted.map((term) => toTermDto(term, row.name, activeTermId)) };
}

export function toClassDto(row: ClassRow): ClassDto {
  return {
    id: row.id,
    academicYearId: row.academicYearId,
    academicYearName: row.academicYear.name,
    name: row.name,
    gradeLevel: row.gradeLevel,
    isActive: row.isActive,
    activeStudentCount: row._count.students,
    subjectCount: row._count.classSubjects,
  };
}

export const toSubjectDto = (row: SubjectRow): SubjectDto => ({
  id: row.id,
  code: row.code,
  name: row.name,
  kkm: row.kkm,
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});

export const toClassSubjectItem = (row: { sortOrder: number; subject: SubjectRow }): ClassSubjectItemDto => ({
  subjectId: row.subject.id,
  code: row.subject.code,
  name: row.subject.name,
  kkm: row.subject.kkm,
  sortOrder: row.sortOrder,
  isActive: row.subject.isActive,
});

/** Select Prisma untuk ClassRow (jumlah siswa AKTIF + jumlah mapel terpetakan). */
export const CLASS_SELECT = {
  id: true,
  academicYearId: true,
  name: true,
  gradeLevel: true,
  isActive: true,
  academicYear: { select: { name: true } },
  _count: { select: { students: { where: { status: "ACTIVE" as const } }, classSubjects: true } },
} as const;

export const SUBJECT_SELECT = { id: true, code: true, name: true, kkm: true, sortOrder: true, isActive: true } as const;
