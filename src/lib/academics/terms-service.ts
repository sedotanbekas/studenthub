import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import { removedRanges, type DateRange } from "@/lib/calendar/ranges";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { dbRange, toTermDto, toTermInput, toYearSummary } from "./dto";
import { assertNoViolation, lockAcademicScope } from "./guards";
import { validateTerm } from "./rules";
import type { CreateTermInput, SetActiveTermInput, SetActiveTermResult, TermDto, UpdateTermInput } from "./schemas";

/**
 * Mutasi semester + semester aktif. Menyempitkan/menghapus semester ditolak bila sudah ada data
 * absensi pada tanggal yang dilepas (review-consistency: perubahan semester tidak boleh diam-diam
 * membuat absensi berada di luar semester).
 */
async function assertNoAttendanceIn(tx: Tx, schoolId: string, ranges: readonly DateRange[]): Promise<void> {
  if (ranges.length === 0) return;
  const count = await tx.attendance.count({
    where: { schoolId, OR: ranges.map((r) => ({ date: { gte: toDbDate(r.startDate), lte: toDbDate(r.endDate) } })) },
  });
  if (count > 0) {
    throw conflict("TERM_HAS_ATTENDANCE", "Sudah ada data absensi pada tanggal yang akan dilepas dari semester ini.");
  }
}

async function findTerm(tx: Tx, scope: SchoolScope, id: string) {
  const term = await tx.term.findFirst({
    where: { id, schoolId: scope.schoolId },
    include: { academicYear: { include: { terms: true } } },
  });
  if (!term) throw notFound("Semester tidak ditemukan.");
  return term;
}

export async function createTerm(scope: SchoolScope, academicYearId: string, input: CreateTermInput, ctx: ActionContext): Promise<TermDto> {
  return withTx(async (tx) => {
    const school = await lockAcademicScope(tx, scope);
    const year = await tx.academicYear.findFirst({ where: { id: academicYearId, schoolId: scope.schoolId }, include: { terms: true } });
    if (!year) throw notFound("Tahun ajaran tidak ditemukan.");
    if (year.terms.some((term) => term.semester === input.semester)) {
      throw conflict("TERM_SEMESTER_TAKEN", "Semester ini sudah ada pada tahun ajaran tersebut.");
    }
    const sibling = year.terms[0] ? toTermInput(year.terms[0]) : null;
    assertNoViolation(validateTerm(input, dbRange(year), sibling));
    const row = await tx.term.create({
      data: {
        schoolId: scope.schoolId,
        academicYearId,
        semester: input.semester,
        startDate: toDbDate(input.startDate),
        endDate: toDbDate(input.endDate),
      },
    });
    const dto = toTermDto(row, year.name, school.activeTermId);
    await writeAudit(tx, { action: "term.create", entityType: "Term", entityId: row.id, schoolId: scope.schoolId, after: dto }, ctx);
    return dto;
  });
}

export async function updateTerm(scope: SchoolScope, id: string, patch: UpdateTermInput, ctx: ActionContext): Promise<TermDto> {
  return withTx(async (tx) => {
    const school = await lockAcademicScope(tx, scope);
    const term = await findTerm(tx, scope, id);
    const before = dbRange(term);
    const next = { semester: term.semester, startDate: patch.startDate ?? before.startDate, endDate: patch.endDate ?? before.endDate };
    const siblingRow = term.academicYear.terms.find((other) => other.id !== term.id);
    assertNoViolation(validateTerm(next, dbRange(term.academicYear), siblingRow ? toTermInput(siblingRow) : null));
    await assertNoAttendanceIn(tx, scope.schoolId, removedRanges(before, next));
    const row = await tx.term.update({ where: { id }, data: { startDate: toDbDate(next.startDate), endDate: toDbDate(next.endDate) } });
    const dto = toTermDto(row, term.academicYear.name, school.activeTermId);
    await writeAudit(tx, { action: "term.update", entityType: "Term", entityId: id, schoolId: scope.schoolId, before, after: dto }, ctx);
    return dto;
  });
}

export async function deleteTerm(scope: SchoolScope, id: string, ctx: ActionContext): Promise<{ id: string }> {
  return withTx(async (tx) => {
    const school = await lockAcademicScope(tx, scope);
    const term = await findTerm(tx, scope, id);
    if (school.activeTermId === id) {
      throw conflict("TERM_ACTIVE", "Semester aktif tidak dapat dihapus. Ganti semester aktif terlebih dahulu.");
    }
    if ((await tx.reportCard.count({ where: { termId: id } })) > 0) {
      throw conflict("TERM_IN_USE", "Semester yang sudah memiliki rapor tidak dapat dihapus.");
    }
    await assertNoAttendanceIn(tx, scope.schoolId, [dbRange(term)]);
    await tx.term.delete({ where: { id } });
    await writeAudit(
      tx,
      { action: "term.delete", entityType: "Term", entityId: id, schoolId: scope.schoolId, before: { semester: term.semester, ...dbRange(term) } },
      ctx,
    );
    return { id };
  });
}

/** Siswa AKTIF tanpa kelas atau dengan kelas di luar tahun ajaran semester baru (peringatan saja). */
async function countStudentsOutsideYear(tx: Tx, schoolId: string, academicYearId: string): Promise<number> {
  return tx.student.count({
    where: {
      schoolId,
      status: "ACTIVE",
      OR: [{ currentClassId: null }, { currentClass: { academicYearId: { not: academicYearId } } }],
    },
  });
}

export async function setActiveTerm(scope: SchoolScope, input: SetActiveTermInput, ctx: ActionContext): Promise<SetActiveTermResult> {
  return withTx(async (tx) => {
    const school = await lockAcademicScope(tx, scope);
    const term = await tx.term.findFirst({ where: { id: input.termId, schoolId: scope.schoolId }, include: { academicYear: true } });
    if (!term) throw notFound("Semester tidak ditemukan.");
    await tx.school.update({ where: { id: scope.schoolId }, data: { activeTermId: term.id } });
    const activeStudentsOutsideYear = await countStudentsOutsideYear(tx, scope.schoolId, term.academicYearId);
    await writeAudit(
      tx,
      {
        action: "term.set_active",
        entityType: "School",
        entityId: scope.schoolId,
        schoolId: scope.schoolId,
        before: { activeTermId: school.activeTermId },
        after: { activeTermId: term.id, activeStudentsOutsideYear },
      },
      ctx,
    );
    return {
      term: toTermDto(term, term.academicYear.name, term.id),
      academicYear: toYearSummary(term.academicYear),
      activeStudentsOutsideYear,
    };
  });
}
