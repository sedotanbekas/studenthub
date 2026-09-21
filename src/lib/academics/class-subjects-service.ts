import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { notFound, unprocessable } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { classLockKey, subjectsLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import { SUBJECT_SELECT, toClassSubjectItem } from "./dto";
import { requireSchool } from "./guards";
import type { ClassSubjectItemDto, ClassSubjectsDto, SetClassSubjectsInput, SetClassSubjectsResult } from "./schemas";

/**
 * Pemetaan kelas-mapel (dasar kelengkapan rapor). PUT mengganti seluruh set; urutan array =
 * sortOrder. Mapel yang BARU dipetakan wajib aktif dan milik sekolah yang sama; mapel nonaktif
 * yang sudah terpetakan boleh tetap dipertahankan.
 *
 * Kunci PUT (paling awal, sebelum membaca): `subjects:<schoolId>` -> `class:<classId>` (kasar -> halus,
 * src/lib/lock-keys.ts). Kunci mapel menyerialkan cek "mapel aktif" di sini dengan nonaktif/hapus mapel;
 * kunci kelas menyerialkan dengan ubah/hapus kelas.
 */
async function requireClass(tx: Tx, scope: SchoolScope, classId: string): Promise<{ id: string }> {
  const found = await tx.schoolClass.findFirst({ where: { id: classId, schoolId: scope.schoolId }, select: { id: true } });
  if (!found) throw notFound("Kelas tidak ditemukan.");
  return found;
}

async function listMapped(tx: Tx, classId: string): Promise<ClassSubjectItemDto[]> {
  const rows = await tx.classSubject.findMany({
    where: { classId },
    orderBy: [{ sortOrder: "asc" }, { subjectId: "asc" }],
    select: { sortOrder: true, subject: { select: SUBJECT_SELECT } },
  });
  return rows.map(toClassSubjectItem);
}

export async function getClassSubjects(tx: Tx, scope: SchoolScope, classId: string): Promise<ClassSubjectsDto> {
  await requireSchool(tx, scope);
  await requireClass(tx, scope, classId);
  return { classId, subjects: await listMapped(tx, classId) };
}

async function assertSubjectsMappable(tx: Tx, scope: SchoolScope, subjectIds: readonly string[], currentIds: ReadonlySet<string>): Promise<void> {
  if (subjectIds.length === 0) return;
  const subjects = await tx.subject.findMany({
    where: { id: { in: [...subjectIds] }, schoolId: scope.schoolId },
    select: { id: true, code: true, isActive: true },
  });
  if (subjects.length !== subjectIds.length) throw notFound("Mapel tidak ditemukan.");
  const inactive = subjects.filter((s) => !s.isActive && !currentIds.has(s.id));
  if (inactive.length > 0) {
    throw unprocessable("SUBJECT_INACTIVE", "Mapel nonaktif tidak dapat dipetakan ke kelas.", { codes: inactive.map((s) => s.code) });
  }
}

/** Nilai rapor DRAFT kelas ini untuk mapel yang tidak lagi dipetakan (dibiarkan sebagai tambahan). */
async function countOrphanGrades(tx: Tx, classId: string, keptIds: readonly string[]): Promise<number> {
  return tx.reportCardGrade.count({
    where: { subjectId: { notIn: [...keptIds] }, reportCard: { classId, status: "DRAFT" } },
  });
}

export async function setClassSubjects(
  scope: SchoolScope,
  classId: string,
  input: SetClassSubjectsInput,
  ctx: ActionContext,
): Promise<SetClassSubjectsResult> {
  return withTx(async (tx) => {
    await lockKey(tx, subjectsLockKey(scope.schoolId));
    await lockKey(tx, classLockKey(classId));
    await requireSchool(tx, scope);
    await requireClass(tx, scope, classId);
    const before = await listMapped(tx, classId);
    await assertSubjectsMappable(tx, scope, input.subjectIds, new Set(before.map((s) => s.subjectId)));
    await tx.classSubject.deleteMany({ where: { classId } });
    if (input.subjectIds.length > 0) {
      await tx.classSubject.createMany({ data: input.subjectIds.map((subjectId, index) => ({ classId, subjectId, sortOrder: index })) });
    }
    const subjects = await listMapped(tx, classId);
    const orphanGradeCount = await countOrphanGrades(tx, classId, input.subjectIds);
    await writeAudit(
      tx,
      {
        action: "class_subject.set",
        entityType: "SchoolClass",
        entityId: classId,
        schoolId: scope.schoolId,
        before: { subjectIds: before.map((s) => s.subjectId) },
        after: { subjectIds: input.subjectIds, orphanGradeCount },
      },
      ctx,
    );
    return { classId, subjects, orphanGradeCount };
  });
}
