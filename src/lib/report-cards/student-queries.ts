import { termLabel } from "@/lib/academics/rules";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { studentSelf } from "@/lib/tenant/scope";
import { MAX_OWN_REPORT_CARDS } from "./constants";
import { averageScore, orderGradesForDisplay } from "./rules";
import type { OwnReportCardDetailDto, OwnReportCardItemDto } from "./schemas";

/**
 * Rapor milik siswa sendiri: HANYA status PUBLISHED (DRAFT/ditarik/milik siswa lain -> 404). Semua nilai
 * dari snapshot yang dibekukan saat terbit. Id siswa selalu dari sesi, tidak pernah dari request.
 */
const TERM_SELECT = { select: { semester: true, academicYear: { select: { name: true } } } } as const;

export async function listOwnReportCards(ctx: ActionContext): Promise<OwnReportCardItemDto[]> {
  const self = studentSelf(requirePrincipal(ctx));
  const rows = await prisma.reportCard.findMany({
    where: { schoolId: self.schoolId, studentId: self.studentId, status: "PUBLISHED" },
    orderBy: [{ term: { startDate: "desc" } }, { id: "asc" }],
    take: MAX_OWN_REPORT_CARDS,
    select: { id: true, termId: true, classNameSnapshot: true, publishedAt: true, updatedAt: true, term: TERM_SELECT, grades: { select: { score: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    termId: row.termId,
    termLabel: termLabel(row.term.semester, row.term.academicYear.name),
    className: row.classNameSnapshot,
    publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
    average: averageScore(row.grades.map((g) => g.score)),
  }));
}

export async function getOwnReportCard(ctx: ActionContext, id: string): Promise<OwnReportCardDetailDto> {
  const self = studentSelf(requirePrincipal(ctx));
  const row = await prisma.reportCard.findFirst({
    where: { id, schoolId: self.schoolId, studentId: self.studentId, status: "PUBLISHED" },
    select: {
      id: true, termId: true, classId: true, classNameSnapshot: true, publishedAt: true, updatedAt: true,
      sickDays: true, permitDays: true, absentDays: true, term: TERM_SELECT,
      grades: { select: { subjectId: true, subjectNameSnapshot: true, kkmSnapshot: true, score: true, predicate: true, description: true } },
    },
  });
  if (!row) throw notFound("Rapor tidak ditemukan.");
  const mapping = await prisma.classSubject.findMany({ where: { classId: row.classId }, select: { subjectId: true, sortOrder: true } });
  const grades = orderGradesForDisplay(
    row.grades.map((g) => ({ ...g, subjectName: g.subjectNameSnapshot })),
    new Map(mapping.map((m) => [m.subjectId, m.sortOrder])),
  );
  return {
    id: row.id,
    termId: row.termId,
    termLabel: termLabel(row.term.semester, row.term.academicYear.name),
    className: row.classNameSnapshot,
    publishedAt: (row.publishedAt ?? row.updatedAt).toISOString(),
    grades: grades.map((g) => ({ subjectName: g.subjectName, kkm: g.kkmSnapshot, score: g.score, predicate: g.predicate, description: g.description })),
    attendance: { sick: row.sickDays ?? 0, permit: row.permitDays ?? 0, absent: row.absentDays ?? 0 },
    average: averageScore(row.grades.map((g) => g.score)),
  };
}
