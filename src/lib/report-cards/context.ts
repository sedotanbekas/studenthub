import type { ReportCardStatus, StudentStatus } from "@prisma/client";
import { termLabel } from "@/lib/academics/rules";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { notFound, unprocessable } from "@/lib/http/errors";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { MAX_ROSTER } from "./constants";
import type { CardGrades, MappedSubject } from "./rules";

/**
 * Pemuat bersama domain rapor. Semua lookup by id memakai findFirst({ id, schoolId }); id milik sekolah
 * lain -> 404. Dipakai query (klien `prisma`) maupun service (klien transaksi `tx`).
 */
export function scopeOf(ctx: ActionContext, schoolId: string | undefined): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), schoolId);
}

export interface TermRow {
  readonly id: string;
  readonly label: string;
  readonly academicYearId: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

export interface ClassRow {
  readonly id: string;
  readonly name: string;
  readonly academicYearId: string;
}

export interface SchoolClock {
  readonly id: string;
  readonly timezone: SchoolTz;
  readonly dayEndMinute: number;
  readonly activeTermId: string | null;
  /** Kalender & status tutup hari (rekap kehadiran rapor). */
  readonly schoolDaysMask: number;
  readonly createdAt: Date;
}

/** Sekolah dalam cakupan; SUPER_ADMIN dengan schoolId tak dikenal -> 404 SCHOOL_NOT_FOUND. */
export async function loadSchoolClock(db: Tx, scope: SchoolScope): Promise<SchoolClock> {
  const school = await db.school.findUnique({
    where: { id: scope.schoolId },
    select: { id: true, timezone: true, dayEndMinute: true, activeTermId: true, schoolDaysMask: true, createdAt: true },
  });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  return school;
}

export async function findTerm(db: Tx, scope: SchoolScope, termId: string): Promise<TermRow> {
  const term = await db.term.findFirst({
    where: { id: termId, schoolId: scope.schoolId },
    select: { id: true, semester: true, academicYearId: true, startDate: true, endDate: true, academicYear: { select: { name: true } } },
  });
  if (!term) throw notFound("Semester tidak ditemukan.");
  return {
    id: term.id,
    label: termLabel(term.semester, term.academicYear.name),
    academicYearId: term.academicYearId,
    startDate: fromDbDate(term.startDate),
    endDate: fromDbDate(term.endDate),
  };
}

export async function findClass(db: Tx, scope: SchoolScope, classId: string): Promise<ClassRow> {
  const klass = await db.schoolClass.findFirst({ where: { id: classId, schoolId: scope.schoolId }, select: { id: true, name: true, academicYearId: true } });
  if (!klass) throw notFound("Kelas tidak ditemukan.");
  return klass;
}

export function assertClassInTermYear(term: TermRow, klass: ClassRow): void {
  if (klass.academicYearId !== term.academicYearId) {
    throw unprocessable("CLASS_TERM_MISMATCH", "Kelas tidak berada pada tahun ajaran semester ini.");
  }
}

/** Semester + kelas milik sekolah (404) dengan tahun ajaran yang sama (422 CLASS_TERM_MISMATCH). */
export async function loadTermClass(db: Tx, scope: SchoolScope, termId: string, classId: string): Promise<{ term: TermRow; klass: ClassRow }> {
  const term = await findTerm(db, scope, termId);
  const klass = await findClass(db, scope, classId);
  assertClassInTermYear(term, klass);
  return { term, klass };
}

export interface MappedSubjectRow extends MappedSubject {
  readonly code: string;
  readonly name: string;
  readonly kkm: number;
}

/** Mapel terpetakan kelas (dasar kelengkapan), urut sortOrder kelas. */
export async function loadMappedSubjects(db: Tx, classId: string): Promise<MappedSubjectRow[]> {
  const rows = await db.classSubject.findMany({
    where: { classId },
    orderBy: [{ sortOrder: "asc" }, { subjectId: "asc" }],
    select: { subjectId: true, sortOrder: true, subject: { select: { code: true, name: true, kkm: true } } },
  });
  return rows.map((r) => ({ subjectId: r.subjectId, sortOrder: r.sortOrder, code: r.subject.code, name: r.subject.name, kkm: r.subject.kkm }));
}

/** Mapel milik sekolah (404) yang wajib dipetakan ke kelas (422 SUBJECT_NOT_IN_CLASS). */
export async function loadClassSubject(db: Tx, scope: SchoolScope, classId: string, subjectId: string): Promise<{ id: string; code: string; name: string; kkm: number }> {
  const subject = await db.subject.findFirst({ where: { id: subjectId, schoolId: scope.schoolId }, select: { id: true, code: true, name: true, kkm: true } });
  if (!subject) throw notFound("Mapel tidak ditemukan.");
  const mapping = await db.classSubject.findUnique({ where: { classId_subjectId: { classId, subjectId } }, select: { subjectId: true } });
  if (!mapping) throw unprocessable("SUBJECT_NOT_IN_CLASS", "Mapel tidak dipetakan ke kelas ini.");
  return subject;
}

// ----------------------------------------------------------------------------- roster kelas

export interface RosterStudent {
  readonly id: string;
  readonly name: string;
  readonly nis: string;
  readonly status: StudentStatus;
}

export interface RosterCard {
  readonly id: string;
  readonly studentId: string;
  readonly status: ReportCardStatus;
  /** Pernah terbit: rekap kehadiran hanya ditulis saat terbit dan dipertahankan saat ditarik. */
  readonly publishedBefore: boolean;
}

export interface Roster {
  /** Siswa AKTIF di kelas ∪ pemegang rapor kelas & semester ini, urut nama. */
  readonly students: RosterStudent[];
  readonly cards: RosterCard[];
  readonly activeInClassIds: string[];
  /** Siswa aktif kelas ini yang rapor semesternya ada di kelas lain (studentId -> nama kelas). */
  readonly otherClass: ReadonlyMap<string, string>;
}

const studentSelect = { id: true, nis: true, status: true, user: { select: { name: true } } } as const;
type StudentPick = { id: string; nis: string; status: StudentStatus; user: { name: string } };
const toRosterStudent = (s: StudentPick): RosterStudent => ({ id: s.id, name: s.user.name, nis: s.nis, status: s.status });

async function loadOtherClassCards(db: Tx, scope: SchoolScope, termId: string, classId: string, studentIds: readonly string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  const rows = await db.reportCard.findMany({
    where: { schoolId: scope.schoolId, termId, classId: { not: classId }, studentId: { in: [...studentIds] } },
    select: { studentId: true, classNameSnapshot: true },
  });
  return new Map(rows.map((r) => [r.studentId, r.classNameSnapshot]));
}

export async function loadRoster(db: Tx, scope: SchoolScope, term: TermRow, klass: ClassRow): Promise<Roster> {
  const active = await db.student.findMany({
    where: { schoolId: scope.schoolId, currentClassId: klass.id, status: "ACTIVE" },
    select: studentSelect,
    take: MAX_ROSTER,
  });
  const cards = await db.reportCard.findMany({
    where: { schoolId: scope.schoolId, termId: term.id, classId: klass.id },
    select: { id: true, studentId: true, status: true, sickDays: true, student: { select: studentSelect } },
    orderBy: { id: "asc" },
    take: MAX_ROSTER,
  });
  const withCard = new Set(cards.map((c) => c.studentId));
  const otherClass = await loadOtherClassCards(db, scope, term.id, klass.id, active.filter((s) => !withCard.has(s.id)).map((s) => s.id));
  const students = new Map([...active.map(toRosterStudent), ...cards.map((c) => toRosterStudent(c.student))].map((s) => [s.id, s]));
  return {
    students: [...students.values()].sort((a, b) => a.name.localeCompare(b.name, "id") || (a.id < b.id ? -1 : 1)),
    cards: cards.map((c) => ({ id: c.id, studentId: c.studentId, status: c.status, publishedBefore: c.sickDays !== null })),
    activeInClassIds: active.map((s) => s.id),
    otherClass,
  };
}

/** Siswa yang boleh dinilai di kelas ini (aktif di kelas atau sudah punya rapor kelas ini). */
export const eligibleIds = (roster: Roster): ReadonlySet<string> => new Set(roster.students.map((s) => s.id));

/** Siswa yang sudah punya rapor semester ini (kelas ini atau kelas lain). */
export const studentsWithCard = (roster: Roster): ReadonlySet<string> =>
  new Set([...roster.cards.map((c) => c.studentId), ...roster.otherClass.keys()]);

/** Mapel yang sudah dinilai per rapor. */
export async function loadCardGrades(db: Tx, cards: readonly RosterCard[]): Promise<CardGrades[]> {
  if (cards.length === 0) return [];
  const grades = await db.reportCardGrade.findMany({ where: { reportCardId: { in: cards.map((c) => c.id) } }, select: { reportCardId: true, subjectId: true } });
  const byCard = groupBy(grades, (g) => g.reportCardId);
  return cards.map((c) => ({
    reportCardId: c.id,
    studentId: c.studentId,
    status: c.status,
    gradedSubjectIds: (byCard.get(c.id) ?? []).map((g) => g.subjectId),
  }));
}

/** Kelompokkan baris per kunci (urutan baris dipertahankan). */
export function groupBy<T>(rows: readonly T[], keyOf: (row: T) => string): ReadonlyMap<string, readonly T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
  return groups;
}
