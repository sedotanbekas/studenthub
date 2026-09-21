import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { withTx } from "@/lib/tx";
import { SUBJECT_SELECT, toSubjectDto } from "./dto";
import { lockSubjectsScope, type ScopedSchool } from "./guards";
import { normalizeName } from "./rules";
import type { CreateSubjectInput, SubjectDto, UpdateSubjectInput } from "./schemas";

/**
 * Mutasi mapel. Kode unik per sekolah (409 SUBJECT_CODE_TAKEN) dan tidak bisa diubah setelah
 * dipakai nilai rapor; nonaktif ditolak selama terpetakan ke kelas aktif tahun ajaran aktif.
 * Setiap mutasi mengambil kunci `subjects:<schoolId>` PALING AWAL (lockSubjectsScope), baru membaca
 * baris terbaru; UPDATE hanya menulis field yang dikirim; audit before/after dari baris terbaru.
 */
async function findSubject(tx: Tx, scope: SchoolScope, id: string): Promise<SubjectDto> {
  const row = await tx.subject.findFirst({ where: { id, schoolId: scope.schoolId }, select: SUBJECT_SELECT });
  if (!row) throw notFound("Mapel tidak ditemukan.");
  return toSubjectDto(row);
}

async function assertCodeFree(tx: Tx, schoolId: string, code: string, excludeId: string | null): Promise<void> {
  const taken = await tx.subject.findFirst({
    where: { schoolId, code, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (taken) throw conflict("SUBJECT_CODE_TAKEN", `Kode mapel ${code} sudah dipakai.`);
}

export async function createSubject(scope: SchoolScope, input: CreateSubjectInput, ctx: ActionContext): Promise<SubjectDto> {
  return withTx(async (tx) => {
    await lockSubjectsScope(tx, scope);
    await assertCodeFree(tx, scope.schoolId, input.code, null);
    const row = await tx.subject.create({
      data: { schoolId: scope.schoolId, code: input.code, name: normalizeName(input.name), kkm: input.kkm, sortOrder: input.sortOrder ?? 0 },
      select: SUBJECT_SELECT,
    });
    const dto = toSubjectDto(row);
    await writeAudit(tx, { action: "subject.create", entityType: "Subject", entityId: row.id, schoolId: scope.schoolId, after: dto }, ctx);
    return dto;
  });
}

async function assertCodeChangeAllowed(tx: Tx, subjectId: string): Promise<void> {
  if ((await tx.reportCardGrade.count({ where: { subjectId } })) > 0) {
    throw conflict("SUBJECT_CODE_LOCKED", "Kode mapel tidak dapat diubah karena sudah dipakai nilai rapor.");
  }
}

/** Terpetakan ke kelas aktif pada tahun ajaran semester aktif -> tidak boleh dinonaktifkan. */
async function assertCanDeactivate(tx: Tx, school: ScopedSchool, subjectId: string): Promise<void> {
  if (!school.activeTermId) return;
  const term = await tx.term.findFirst({ where: { id: school.activeTermId, schoolId: school.id }, select: { academicYearId: true } });
  if (!term) return;
  const mapped = await tx.classSubject.count({
    where: { subjectId, schoolClass: { isActive: true, academicYearId: term.academicYearId } },
  });
  if (mapped > 0) {
    throw conflict("SUBJECT_MAPPED", `Mapel masih dipetakan ke ${mapped} kelas aktif tahun ajaran berjalan. Lepas pemetaannya terlebih dahulu.`);
  }
}

/** Data UPDATE hanya dari field yang dikirim; kolom lain tidak ditulis ulang. */
function subjectPatchData(patch: UpdateSubjectInput): Prisma.SubjectUpdateInput {
  return {
    ...(patch.code === undefined ? {} : { code: patch.code }),
    ...(patch.name === undefined ? {} : { name: normalizeName(patch.name) }),
    ...(patch.kkm === undefined ? {} : { kkm: patch.kkm }),
    ...(patch.sortOrder === undefined ? {} : { sortOrder: patch.sortOrder }),
    ...(patch.isActive === undefined ? {} : { isActive: patch.isActive }),
  };
}

export async function updateSubject(scope: SchoolScope, id: string, patch: UpdateSubjectInput, ctx: ActionContext): Promise<SubjectDto> {
  return withTx(async (tx) => {
    const school = await lockSubjectsScope(tx, scope);
    const current = await findSubject(tx, scope, id);
    if (patch.code !== undefined && patch.code !== current.code) {
      await assertCodeChangeAllowed(tx, id);
      await assertCodeFree(tx, scope.schoolId, patch.code, id);
    }
    if (patch.isActive === false && current.isActive) await assertCanDeactivate(tx, school, id);
    const row = await tx.subject.update({ where: { id }, data: subjectPatchData(patch), select: SUBJECT_SELECT });
    const dto = toSubjectDto(row);
    await writeAudit(tx, { action: "subject.update", entityType: "Subject", entityId: id, schoolId: scope.schoolId, before: current, after: dto }, ctx);
    return dto;
  });
}

export async function deleteSubject(scope: SchoolScope, id: string, ctx: ActionContext): Promise<{ id: string }> {
  return withTx(async (tx) => {
    await lockSubjectsScope(tx, scope);
    const current = await findSubject(tx, scope, id);
    const [grades, mappings] = [
      await tx.reportCardGrade.count({ where: { subjectId: id } }),
      await tx.classSubject.count({ where: { subjectId: id } }),
    ];
    if (grades + mappings > 0) {
      throw conflict("SUBJECT_IN_USE", "Mapel sudah dipakai kelas atau nilai rapor. Nonaktifkan mapel sebagai gantinya.");
    }
    await tx.subject.delete({ where: { id } });
    await writeAudit(tx, { action: "subject.delete", entityType: "Subject", entityId: id, schoolId: scope.schoolId, before: current }, ctx);
    return { id };
  });
}
