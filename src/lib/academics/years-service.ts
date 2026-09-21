import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import type { DateRange } from "@/lib/calendar/ranges";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { dbRange, toYearDto } from "./dto";
import { assertNoViolation, lockAcademicScope } from "./guards";
import { findOverlappingYear, validateAcademicYear, validateYearContainsTerms } from "./rules";
import type { AcademicYearDto, CreateAcademicYearInput, UpdateAcademicYearInput } from "./schemas";

/**
 * Mutasi tahun ajaran. Semua mutasi akademik satu sekolah diserialkan dengan kunci aplikasi
 * `academic:<schoolId>` (cek irisan tanggal + nama unik tanpa race).
 */
const MAX_YEARS_SCANNED = 200;

async function assertYearSlotFree(tx: Tx, schoolId: string, candidate: DateRange & { name: string }, excludeId: string | null): Promise<void> {
  const others = await tx.academicYear.findMany({
    where: { schoolId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, startDate: true, endDate: true },
    take: MAX_YEARS_SCANNED,
  });
  if (others.some((other) => other.name === candidate.name)) {
    throw conflict("ACADEMIC_YEAR_NAME_TAKEN", `Tahun ajaran ${candidate.name} sudah ada.`);
  }
  const overlap = findOverlappingYear(candidate, others.map((o) => ({ name: o.name, ...dbRange(o) })));
  if (overlap) throw conflict("ACADEMIC_YEAR_OVERLAP", `Rentang tanggal beririsan dengan tahun ajaran ${overlap.name}.`);
}

async function findYear(tx: Tx, scope: SchoolScope, id: string) {
  const year = await tx.academicYear.findFirst({ where: { id, schoolId: scope.schoolId }, include: { terms: true } });
  if (!year) throw notFound("Tahun ajaran tidak ditemukan.");
  return year;
}

export async function createAcademicYear(scope: SchoolScope, input: CreateAcademicYearInput, ctx: ActionContext): Promise<AcademicYearDto> {
  assertNoViolation(validateAcademicYear(input));
  return withTx(async (tx) => {
    const school = await lockAcademicScope(tx, scope);
    await assertYearSlotFree(tx, scope.schoolId, input, null);
    const row = await tx.academicYear.create({
      data: { schoolId: scope.schoolId, name: input.name, startDate: toDbDate(input.startDate), endDate: toDbDate(input.endDate) },
    });
    const dto = toYearDto(row, [], school.activeTermId);
    await writeAudit(tx, { action: "academic_year.create", entityType: "AcademicYear", entityId: row.id, schoolId: scope.schoolId, after: dto }, ctx);
    return dto;
  });
}

export async function updateAcademicYear(
  scope: SchoolScope,
  id: string,
  patch: UpdateAcademicYearInput,
  ctx: ActionContext,
): Promise<AcademicYearDto> {
  return withTx(async (tx) => {
    const school = await lockAcademicScope(tx, scope);
    const current = await findYear(tx, scope, id);
    const before = dbRange(current);
    const next = { name: patch.name ?? current.name, startDate: patch.startDate ?? before.startDate, endDate: patch.endDate ?? before.endDate };
    assertNoViolation(validateAcademicYear(next));
    assertNoViolation(validateYearContainsTerms(next, current.terms.map(dbRange)));
    await assertYearSlotFree(tx, scope.schoolId, next, id);
    const row = await tx.academicYear.update({
      where: { id },
      data: { name: next.name, startDate: toDbDate(next.startDate), endDate: toDbDate(next.endDate) },
    });
    const dto = toYearDto(row, current.terms, school.activeTermId);
    await writeAudit(
      tx,
      { action: "academic_year.update", entityType: "AcademicYear", entityId: id, schoolId: scope.schoolId, before: { name: current.name, ...before }, after: next },
      ctx,
    );
    return dto;
  });
}

export async function deleteAcademicYear(scope: SchoolScope, id: string, ctx: ActionContext): Promise<{ id: string }> {
  return withTx(async (tx) => {
    await lockAcademicScope(tx, scope);
    const current = await findYear(tx, scope, id);
    const classCount = await tx.schoolClass.count({ where: { academicYearId: id } });
    if (current.terms.length > 0 || classCount > 0) {
      throw conflict("ACADEMIC_YEAR_IN_USE", "Tahun ajaran yang sudah memiliki semester atau kelas tidak dapat dihapus.");
    }
    await tx.academicYear.delete({ where: { id } });
    await writeAudit(
      tx,
      { action: "academic_year.delete", entityType: "AcademicYear", entityId: id, schoolId: scope.schoolId, before: { name: current.name, ...dbRange(current) } },
      ctx,
    );
    return { id };
  });
}
