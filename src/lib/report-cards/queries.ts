import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { unprocessable } from "@/lib/http/errors";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import type { SchoolScope } from "@/lib/tenant/scope";
import {
  groupBy,
  loadCardGrades,
  loadClassSubject,
  loadMappedSubjects,
  loadRoster,
  loadSchoolClock,
  loadTermClass,
  scopeOf,
  studentsWithCard,
  type Roster,
  type RosterCard,
  type RosterStudent,
} from "./context";
import { termUnclosedDates } from "./attendance";
import { loadReportCardDetail } from "./detail";
import { averageScore, classifyReadiness, computePredicate } from "./rules";
import type {
  ListReportCardsQuery,
  ReadinessDto,
  ReadinessQuery,
  ReportCardDetailDto,
  ReportCardListItemDto,
  SheetDto,
  SheetQuery,
} from "./schemas";

/** Query baca rapor untuk admin (selalu ber-scope & ber-take). */

type SheetGrade = { reportCardId: string; score: number; predicate: SheetDto["rows"][number]["predicate"]; description: string | null };

interface SheetLookup {
  readonly roster: Roster;
  readonly cardByStudent: ReadonlyMap<string, RosterCard>;
  readonly gradeByCard: ReadonlyMap<string, SheetGrade>;
  readonly kkm: number;
}

function sheetRow(student: RosterStudent, lookup: SheetLookup): SheetDto["rows"][number] {
  const card = lookup.cardByStudent.get(student.id) ?? null;
  const grade = card ? lookup.gradeByCard.get(card.id) : undefined;
  const isDraft = card?.status !== "PUBLISHED";
  return {
    studentId: student.id,
    name: student.name,
    nis: student.nis,
    studentStatus: student.status,
    reportCardId: card?.id ?? null,
    reportCardStatus: card?.status ?? null,
    score: grade?.score ?? null,
    predicate: grade ? (isDraft ? computePredicate(grade.score, lookup.kkm) : grade.predicate) : null,
    description: grade?.description ?? null,
    blockedReason: card?.status === "PUBLISHED" ? "PUBLISHED" : lookup.roster.otherClass.has(student.id) ? "OTHER_CLASS" : null,
  };
}

/** GET /school/report-cards/sheet: grid nilai satu kelas & satu mapel. */
export async function getGradeSheet(ctx: ActionContext, query: SheetQuery): Promise<SheetDto> {
  const scope = scopeOf(ctx, query.schoolId);
  const { term, klass } = await loadTermClass(prisma, scope, query.termId, query.classId);
  const subject = await loadClassSubject(prisma, scope, klass.id, query.subjectId);
  const roster = await loadRoster(prisma, scope, term, klass);
  const grades = await prisma.reportCardGrade.findMany({
    where: { reportCardId: { in: roster.cards.map((c) => c.id) }, subjectId: subject.id },
    select: { reportCardId: true, score: true, predicate: true, description: true },
  });
  const lookup: SheetLookup = {
    roster,
    cardByStudent: new Map(roster.cards.map((c) => [c.studentId, c])),
    gradeByCard: new Map(grades.map((g) => [g.reportCardId, g])),
    kkm: subject.kkm,
  };
  return {
    term: { id: term.id, label: term.label },
    class: { id: klass.id, name: klass.name },
    subject: { id: subject.id, code: subject.code, name: subject.name, kkm: subject.kkm },
    rows: roster.students.map((s) => sheetRow(s, lookup)),
  };
}

/** GET /school/report-cards/readiness: kesiapan terbit satu kelas. */
export async function getReadiness(ctx: ActionContext, query: ReadinessQuery): Promise<ReadinessDto> {
  const scope = scopeOf(ctx, query.schoolId);
  const { term, klass } = await loadTermClass(prisma, scope, query.termId, query.classId);
  const mapped = await loadMappedSubjects(prisma, klass.id);
  if (mapped.length === 0) throw unprocessable("CLASS_HAS_NO_SUBJECTS", "Kelas belum memiliki mapel terpetakan.");
  const roster = await loadRoster(prisma, scope, term, klass);
  const readiness = classifyReadiness({
    mapped,
    cards: await loadCardGrades(prisma, roster.cards),
    activeStudentIds: roster.activeInClassIds,
    studentsWithCard: studentsWithCard(roster),
  });
  const attendanceUnclosedDates = await termUnclosedDates(prisma, term, await loadSchoolClock(prisma, scope), ctx.now);
  return { term: { id: term.id, label: term.label }, class: { id: klass.id, name: klass.name }, subjectCount: mapped.length, ...readiness, attendanceUnclosedDates };
}

export function getReportCard(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<ReportCardDetailDto> {
  return loadReportCardDetail(prisma, scopeOf(ctx, schoolId), id, ctx.now);
}

// ----------------------------------------------------------------------------- daftar

function listWhere(scope: SchoolScope, termId: string, query: ListReportCardsQuery): Prisma.ReportCardWhereInput {
  const q = likeSearch(query.q);
  return {
    schoolId: scope.schoolId,
    termId,
    ...(query.classId ? { classId: query.classId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(q ? { student: { OR: [{ user: { name: { contains: q } } }, { nis: { startsWith: q } }] } } : {}),
  };
}

const LIST_SELECT = {
  id: true, termId: true, classId: true, classNameSnapshot: true, status: true, publishedAt: true, updatedAt: true,
  student: { select: { id: true, nis: true, user: { select: { name: true } } } },
  grades: { select: { subjectId: true, score: true } },
} as const;
type ListRow = Prisma.ReportCardGetPayload<{ select: typeof LIST_SELECT }>;

function toListItem(row: ListRow, mappedIds: ReadonlySet<string>): ReportCardListItemDto {
  const published = row.status === "PUBLISHED";
  return {
    id: row.id,
    student: { id: row.student.id, name: row.student.user.name, nis: row.student.nis },
    termId: row.termId,
    classId: row.classId,
    className: row.classNameSnapshot,
    status: row.status,
    gradedCount: published ? row.grades.length : row.grades.filter((g) => mappedIds.has(g.subjectId)).length,
    expectedCount: published ? row.grades.length : mappedIds.size,
    average: averageScore(row.grades.map((g) => g.score)),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /school/report-cards: default semester aktif; tanpa semester aktif & tanpa termId -> daftar kosong. */
export async function listReportCards(ctx: ActionContext, query: ListReportCardsQuery): Promise<{ data: ReportCardListItemDto[]; meta: PageMeta }> {
  const scope = scopeOf(ctx, query.schoolId);
  const clock = await loadSchoolClock(prisma, scope);
  const termId = query.termId ?? clock.activeTermId;
  if (!termId) return { data: [], meta: pageMeta(0, query.page, query.limit) };
  const where = listWhere(scope, termId, query);
  const [total, rows] = await Promise.all([
    prisma.reportCard.count({ where }),
    prisma.reportCard.findMany({
      where,
      orderBy: [{ classNameSnapshot: "asc" }, { student: { user: { name: "asc" } } }, { id: "asc" }],
      ...toSkipTake(query),
      select: LIST_SELECT,
    }),
  ]);
  const classIds = [...new Set(rows.map((r) => r.classId))];
  const mapping = classIds.length === 0 ? [] : await prisma.classSubject.findMany({ where: { classId: { in: classIds } }, select: { classId: true, subjectId: true } });
  const mappedByClass = groupBy(mapping, (m) => m.classId);
  const data = rows.map((row) => toListItem(row, new Set((mappedByClass.get(row.classId) ?? []).map((m) => m.subjectId))));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}
