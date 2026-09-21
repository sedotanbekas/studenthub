import type { ActionContext } from "@/lib/auth/principal";
import { requirePrincipal } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth/sessions";
import type { Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { fromDbDate, toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { getActivationGaps, newGapsAfterPatch, type ActivationInput } from "./activation-rules";
import { activationInputOf } from "./dto";
import { activationIncomplete, assertIdentityFree, resolveAssignableClass, withStudentConflicts } from "./guards";
import { claimNisn, recordNisnReleases, type ReleasedHolder } from "./nisn-claim";
import { canChangeNisn, diffStudentPatch, gapFieldsOf, type PatchableSnapshot, type StudentPatch } from "./patch-rules";
import { loadStudentDetail } from "./queries";
import { findStudentRow, loadSchoolContext, lockStudentRow, scopeFor, type ClassRef, type SchoolContext, type StudentRow } from "./records";
import type { StudentDetail, UpdateStudentInput } from "./schemas";

/**
 * PATCH siswa (parsial). Nama juga memperbarui User.name. NISN: admin sekolah hanya saat DRAFT
 * (409 NISN_LOCKED); super admin kapan saja (klaim ulang + cabut sesi bila NISN sedang dipegang).
 * Ganti kelas: kelas aktif milik sekolah; siswa AKTIF tidak boleh memperoleh kekurangan baru (422).
 */
function snapshotOf(row: StudentRow): PatchableSnapshot {
  return {
    name: row.user.name,
    nisn: row.nisn,
    nis: row.nis,
    gender: row.gender,
    birthPlace: row.birthPlace,
    birthDate: row.birthDate === null ? null : fromDbDate(row.birthDate),
    address: row.address,
    guardianName: row.guardianName,
    guardianPhone: row.guardianPhone,
    currentClassId: row.currentClassId,
    sppAmount: row.sppAmount,
  };
}

function mergedActivationInput(row: StudentRow, school: SchoolContext, changes: StudentPatch, klass: ClassRef | null | undefined): ActivationInput {
  const base = activationInputOf(row, school);
  const pick = <K extends keyof StudentPatch>(key: K, fallback: PatchableSnapshot[K]): PatchableSnapshot[K] =>
    key in changes ? (changes[key] as PatchableSnapshot[K]) : fallback;
  return {
    ...base,
    name: pick("name", row.user.name),
    nisn: pick("nisn", row.nisn),
    nis: pick("nis", row.nis),
    gender: pick("gender", row.gender),
    birthPlace: pick("birthPlace", base.birthPlace),
    birthDate: pick("birthDate", base.birthDate),
    address: pick("address", base.address),
    guardianName: pick("guardianName", base.guardianName),
    guardianPhone: pick("guardianPhone", base.guardianPhone),
    classId: pick("currentClassId", base.classId),
    class: klass === undefined ? base.class : klass,
  };
}

async function checkChanges(tx: Tx, scope: SchoolScope, row: StudentRow, changes: StudentPatch, ctx: ActionContext): Promise<ClassRef | null | undefined> {
  if (changes.nisn !== undefined && !canChangeNisn(requirePrincipal(ctx).role, row.status)) {
    throw conflict("NISN_LOCKED", "NISN hanya dapat diubah selama siswa berstatus Draf. Hubungi super admin untuk koreksi NISN.");
  }
  await assertIdentityFree(tx, scope, { nisn: changes.nisn, nis: changes.nis }, row.id);
  return "currentClassId" in changes ? resolveAssignableClass(tx, scope, changes.currentClassId ?? null) : undefined;
}

function assertStillComplete(row: StudentRow, school: SchoolContext, changes: StudentPatch, klass: ClassRef | null | undefined, now: Date): void {
  if (row.status !== "ACTIVE") return;
  const before = getActivationGaps(activationInputOf(row, school), now);
  const after = getActivationGaps(mergedActivationInput(row, school, changes, klass), now);
  const introduced = newGapsAfterPatch(before, after, gapFieldsOf(changes));
  if (introduced.length > 0) throw activationIncomplete(introduced);
}

function studentUpdateData(row: StudentRow, changes: StudentPatch) {
  const { name: _name, birthDate, nisn, ...rest } = changes;
  return {
    ...rest,
    ...(birthDate !== undefined ? { birthDate: birthDate === null ? null : toDbDate(birthDate) } : {}),
    ...(nisn !== undefined ? { nisn, ...(row.activeNisn !== null ? { activeNisn: nisn } : {}) } : {}),
  };
}

async function persistChanges(tx: Tx, scope: SchoolScope, row: StudentRow, changes: StudentPatch, ctx: ActionContext): Promise<ReleasedHolder | null> {
  const reclaim = changes.nisn !== undefined && row.activeNisn !== null;
  const released = reclaim ? await claimNisn(tx, { studentId: row.id, nisn: changes.nisn as string }, ctx) : null;
  const updated = await tx.student.updateMany({ where: { id: row.id, schoolId: scope.schoolId }, data: studentUpdateData(row, changes) });
  if (updated.count !== 1) throw conflict("STUDENT_STATE_CHANGED", "Data siswa berubah bersamaan. Silakan muat ulang.");
  if (changes.name !== undefined) await tx.user.update({ where: { id: row.userId }, data: { name: changes.name } });
  if (reclaim) await revokeAllSessions(tx, row.userId, "ADMIN_REVOKED", ctx.now);
  return released;
}

async function applyUpdate(tx: Tx, scope: SchoolScope, id: string, input: UpdateStudentInput, ctx: ActionContext): Promise<void> {
  const school = await loadSchoolContext(tx, scope);
  await lockStudentRow(tx, scope, id);
  const row = await findStudentRow(tx, scope, id);
  const current = snapshotOf(row);
  const changes = diffStudentPatch(current, input);
  if (Object.keys(changes).length === 0) return;
  const klass = await checkChanges(tx, scope, row, changes, ctx);
  assertStillComplete(row, school, changes, klass, ctx.now);
  const released = await persistChanges(tx, scope, row, changes, ctx);
  await recordNisnReleases(tx, released ? [released] : [], ctx);
  const before = Object.fromEntries(Object.keys(changes).map((key) => [key, current[key as keyof PatchableSnapshot]]));
  await writeAudit(
    tx,
    { action: "student.update", entityType: "Student", entityId: row.id, schoolId: scope.schoolId, before, after: { ...changes, nisnReleased: released !== null } },
    ctx,
  );
}

export async function updateStudent(ctx: ActionContext, schoolId: string | undefined, id: string, input: UpdateStudentInput): Promise<StudentDetail> {
  const scope = scopeFor(ctx, schoolId);
  await withStudentConflicts(() => withTx((tx) => applyUpdate(tx, scope, id, input, ctx)));
  return loadStudentDetail(scope, id, ctx.now);
}
