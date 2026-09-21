import type { GradePredicate } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { termAttendanceByStudent } from "./attendance";
import { findTerm, loadMappedSubjects, loadSchoolClock, type MappedSubjectRow } from "./context";
import { averageScore, computePredicate, missingSubjectIds, orderGradesForDisplay, ZERO_ATTENDANCE, type AttendanceSummary } from "./rules";
import type { ReportCardDetailDto } from "./schemas";

/**
 * Detail rapor untuk admin. DRAFT: nama mapel, KKM, dan predikat dihitung dari mapel TERKINI dan rekap
 * kehadiran dihitung langsung (+ hari yang belum ditutup auto-ALPHA). PUBLISHED: semua dari snapshot yang dibekukan saat terbit.
 */
const DETAIL_SELECT = {
  id: true,
  status: true,
  termId: true,
  classId: true,
  classNameSnapshot: true,
  publishedAt: true,
  updatedAt: true,
  sickDays: true,
  permitDays: true,
  absentDays: true,
  student: { select: { id: true, nis: true, user: { select: { name: true } } } },
  grades: {
    select: {
      subjectId: true, subjectNameSnapshot: true, kkmSnapshot: true, score: true, predicate: true, description: true,
      subject: { select: { name: true, kkm: true } },
    },
  },
} as const;

interface GradeRow {
  readonly subjectId: string;
  readonly subjectNameSnapshot: string;
  readonly kkmSnapshot: number;
  readonly score: number;
  readonly predicate: GradePredicate;
  readonly description: string | null;
  readonly subject: { readonly name: string; readonly kkm: number };
}

export type DetailGrade = ReportCardDetailDto["grades"][number];

/** Nilai untuk tampilan: DRAFT memakai mapel terkini, PUBLISHED memakai snapshot. */
export function gradeViews(grades: readonly GradeRow[], isDraft: boolean, mapped: readonly MappedSubjectRow[]): DetailGrade[] {
  const order = new Map(mapped.map((m) => [m.subjectId, m.sortOrder]));
  const views = grades.map((g) => ({
    subjectId: g.subjectId,
    subjectName: isDraft ? g.subject.name : g.subjectNameSnapshot,
    kkm: isDraft ? g.subject.kkm : g.kkmSnapshot,
    score: g.score,
    predicate: isDraft ? computePredicate(g.score, g.subject.kkm) : g.predicate,
    description: g.description,
    isMapped: order.has(g.subjectId),
  }));
  return orderGradesForDisplay(views, order);
}

const snapshotOf = (card: { sickDays: number | null; permitDays: number | null; absentDays: number | null }): AttendanceSummary => ({
  sick: card.sickDays ?? 0,
  permit: card.permitDays ?? 0,
  absent: card.absentDays ?? 0,
});

export async function loadReportCardDetail(db: Tx, scope: SchoolScope, id: string, now: Date): Promise<ReportCardDetailDto> {
  const card = await db.reportCard.findFirst({ where: { id, schoolId: scope.schoolId }, select: DETAIL_SELECT });
  if (!card) throw notFound("Rapor tidak ditemukan.");
  const term = await findTerm(db, scope, card.termId);
  const mapped = await loadMappedSubjects(db, card.classId);
  const isDraft = card.status === "DRAFT";
  const live = isDraft ? await termAttendanceByStudent(db, scope, term, await loadSchoolClock(db, scope), [card.student.id], now) : null;
  return {
    id: card.id,
    student: { id: card.student.id, name: card.student.user.name, nis: card.student.nis },
    term: { id: term.id, label: term.label },
    classId: card.classId,
    className: card.classNameSnapshot,
    status: card.status,
    publishedAt: card.publishedAt?.toISOString() ?? null,
    grades: gradeViews(card.grades, isDraft, mapped),
    missingSubjectIds: isDraft ? missingSubjectIds(mapped, card.grades.map((g) => g.subjectId)) : [],
    attendanceSummary: {
      ...(live ? live.summaries.get(card.student.id) ?? ZERO_ATTENDANCE : snapshotOf(card)),
      isSnapshot: !isDraft,
      unclosedDates: live ? [...live.unclosedDates] : [],
    },
    average: averageScore(card.grades.map((g) => g.score)),
    updatedAt: card.updatedAt.toISOString(),
  };
}
