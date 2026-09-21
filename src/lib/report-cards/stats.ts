import { prisma } from "@/lib/db";
import type { SchoolScope } from "@/lib/tenant/scope";
import { findTerm, loadSchoolClock } from "./context";

/**
 * Statistik rapor untuk dashboard admin sekolah (desain 03 §I.3). Semua hitungan hanya siswa AKTIF
 * sehingga membentuk corong: activeStudents >= studentsWithGrades >= studentsComplete >= published.
 * - term: `termId` bila diisi (milik sekolah lain -> 404), selain itu semester aktif; null bila tidak ada.
 * - studentsWithGrades: rapor semester itu yang memiliki >= 1 nilai.
 * - studentsComplete: rapor TERBIT, atau DRAFT yang seluruh mapel terpetakan kelasnya sudah dinilai (min. 1 mapel).
 * - published: rapor TERBIT.
 */
export interface ReportCardStats {
  readonly term: { readonly id: string; readonly label: string } | null;
  readonly activeStudents: number;
  readonly studentsWithGrades: number;
  readonly studentsComplete: number;
  readonly published: number;
}

async function countComplete(schoolId: string, termId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
    SELECT COUNT(*) AS \`total\`
    FROM \`ReportCard\` rc
    JOIN \`Student\` s ON s.\`id\` = rc.\`studentId\`
    WHERE rc.\`schoolId\` = ${schoolId} AND rc.\`termId\` = ${termId} AND s.\`status\` = 'ACTIVE'
      AND (
        rc.\`status\` = 'PUBLISHED'
        OR (
          EXISTS (SELECT 1 FROM \`ClassSubject\` cs WHERE cs.\`classId\` = rc.\`classId\`)
          AND NOT EXISTS (
            SELECT 1 FROM \`ClassSubject\` cs
            WHERE cs.\`classId\` = rc.\`classId\`
              AND NOT EXISTS (SELECT 1 FROM \`ReportCardGrade\` g WHERE g.\`reportCardId\` = rc.\`id\` AND g.\`subjectId\` = cs.\`subjectId\`)
          )
        )
      )`;
  return Number(rows[0]?.total ?? 0);
}

async function resolveStatsTerm(scope: SchoolScope, termId: string | undefined): Promise<{ id: string; label: string } | null> {
  const id = termId ?? (await loadSchoolClock(prisma, scope)).activeTermId;
  if (!id) return null;
  const term = await findTerm(prisma, scope, id);
  return { id: term.id, label: term.label };
}

export async function reportCardStats(scope: SchoolScope, options: { readonly termId?: string } = {}): Promise<ReportCardStats> {
  const term = await resolveStatsTerm(scope, options.termId);
  const activeStudents = await prisma.student.count({ where: { schoolId: scope.schoolId, status: "ACTIVE" } });
  if (!term) return { term: null, activeStudents, studentsWithGrades: 0, studentsComplete: 0, published: 0 };
  const base = { schoolId: scope.schoolId, termId: term.id, student: { status: "ACTIVE" as const } };
  const [studentsWithGrades, studentsComplete, published] = await Promise.all([
    prisma.reportCard.count({ where: { ...base, grades: { some: {} } } }),
    countComplete(scope.schoolId, term.id),
    prisma.reportCard.count({ where: { ...base, status: "PUBLISHED" } }),
  ]);
  return { term, activeStudents, studentsWithGrades, studentsComplete, published };
}
