import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { lockKey, withTx } from "@/lib/tx";
import { CLASS_SELECT, toClassDto } from "./dto";
import { requireSchool } from "./guards";
import { normalizeName } from "./rules";
import type { ClassDto, CreateClassInput, UpdateClassInput } from "./schemas";

/**
 * Mutasi kelas (rombongan belajar). Nama unik per tahun ajaran (409 CLASS_NAME_TAKEN);
 * nonaktif hanya tanpa siswa AKTIF; hapus hanya bila tidak dirujuk data lain.
 */
const classLockKey = (academicYearId: string): string => `classes:${academicYearId}`;

export async function loadClassDto(tx: Tx, scope: SchoolScope, id: string): Promise<ClassDto> {
  const row = await tx.schoolClass.findFirst({ where: { id, schoolId: scope.schoolId }, select: CLASS_SELECT });
  if (!row) throw notFound("Kelas tidak ditemukan.");
  return toClassDto(row);
}

async function assertNameFree(tx: Tx, academicYearId: string, name: string, excludeId: string | null): Promise<void> {
  const taken = await tx.schoolClass.findFirst({
    where: { academicYearId, name, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  if (taken) throw conflict("CLASS_NAME_TAKEN", `Nama kelas "${name}" sudah dipakai pada tahun ajaran ini.`);
}

export async function createClass(scope: SchoolScope, input: CreateClassInput, ctx: ActionContext): Promise<ClassDto> {
  const name = normalizeName(input.name);
  return withTx(async (tx) => {
    await requireSchool(tx, scope);
    const year = await tx.academicYear.findFirst({ where: { id: input.academicYearId, schoolId: scope.schoolId }, select: { id: true } });
    if (!year) throw notFound("Tahun ajaran tidak ditemukan.");
    await lockKey(tx, classLockKey(year.id));
    await assertNameFree(tx, year.id, name, null);
    const row = await tx.schoolClass.create({
      data: { schoolId: scope.schoolId, academicYearId: year.id, name, gradeLevel: input.gradeLevel },
      select: CLASS_SELECT,
    });
    const dto = toClassDto(row);
    await writeAudit(tx, { action: "class.create", entityType: "SchoolClass", entityId: row.id, schoolId: scope.schoolId, after: dto }, ctx);
    return dto;
  });
}

async function assertCanDeactivate(tx: Tx, classId: string): Promise<void> {
  const active = await tx.student.count({ where: { currentClassId: classId, status: "ACTIVE" } });
  if (active > 0) {
    throw conflict("CLASS_HAS_STUDENTS", `Kelas masih memiliki ${active} siswa aktif. Pindahkan siswa terlebih dahulu.`);
  }
}

export async function updateClass(scope: SchoolScope, id: string, patch: UpdateClassInput, ctx: ActionContext): Promise<ClassDto> {
  return withTx(async (tx) => {
    await requireSchool(tx, scope);
    const current = await loadClassDto(tx, scope, id);
    await lockKey(tx, classLockKey(current.academicYearId));
    const name = patch.name === undefined ? current.name : normalizeName(patch.name);
    if (name !== current.name) await assertNameFree(tx, current.academicYearId, name, id);
    if (patch.isActive === false && current.isActive) await assertCanDeactivate(tx, id);
    await tx.schoolClass.update({
      where: { id },
      data: { name, gradeLevel: patch.gradeLevel ?? current.gradeLevel, isActive: patch.isActive ?? current.isActive },
    });
    const dto = await loadClassDto(tx, scope, id);
    await writeAudit(tx, { action: "class.update", entityType: "SchoolClass", entityId: id, schoolId: scope.schoolId, before: current, after: dto }, ctx);
    return dto;
  });
}

async function classReferenceCount(tx: Tx, classId: string): Promise<number> {
  const counts = await Promise.all([
    tx.student.count({ where: { currentClassId: classId } }),
    tx.attendance.count({ where: { classId } }),
    tx.reportCard.count({ where: { classId } }),
    tx.announcementTarget.count({ where: { classId } }),
  ]);
  return counts.reduce((sum, n) => sum + n, 0);
}

export async function deleteClass(scope: SchoolScope, id: string, ctx: ActionContext): Promise<{ id: string }> {
  return withTx(async (tx) => {
    await requireSchool(tx, scope);
    const current = await loadClassDto(tx, scope, id);
    if ((await classReferenceCount(tx, id)) > 0) {
      throw conflict("CLASS_IN_USE", "Kelas sudah dipakai (siswa, absensi, rapor, atau pengumuman). Nonaktifkan kelas sebagai gantinya.");
    }
    await tx.schoolClass.delete({ where: { id } });
    await writeAudit(tx, { action: "class.delete", entityType: "SchoolClass", entityId: id, schoolId: scope.schoolId, before: current }, ctx);
    return { id };
  });
}
