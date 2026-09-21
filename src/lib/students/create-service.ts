import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { getActivationGaps, type ActivationInput } from "./activation-rules";
import {
  activationIncomplete,
  assertIdentityFree,
  issueTemporaryPassword,
  resolveAssignableClass,
  withStudentConflicts,
  type TemporaryCredential,
} from "./guards";
import { claimNisn } from "./nisn-claim";
import { recordNisnReleases } from "./nisn-release-log";
import { loadSchoolContext, lockForStudentWrite, scopeFor, type ClassRef, type SchoolContext } from "./records";
import { loadStudentDetail } from "./queries";
import type { CreateStudentInput, StudentDetail } from "./schemas";

/**
 * Buat siswa (POST /school/students). activate=true (default): data wajib harus lengkap (422
 * ACTIVATION_INCOMPLETE, TANPA tulis apa pun), NISN diklaim, status ACTIVE. activate=false: DRAFT,
 * User.isActive=false, activeNisn NULL. Kata sandi awal SELALU di-generate dan dikembalikan sekali.
 * Pemeriksaan di luar transaksi hanya fail-fast; di dalam transaksi kunci (kelas + kuota pelepasan NISN)
 * diambil PALING AWAL lalu sekolah, kelas (aktif? 422 CLASS_INACTIVE) & kelengkapan diperiksa ULANG.
 */
export interface CreateStudentResult {
  readonly student: StudentDetail;
  readonly temporaryPassword: string;
  readonly tempPasswordExpiresAt: string;
  readonly nisnReleased: boolean;
}

function toActivationInput(input: CreateStudentInput, klass: ClassRef | null, school: SchoolContext): ActivationInput {
  return {
    name: input.name,
    nisn: input.nisn,
    nis: input.nis,
    gender: input.gender,
    birthPlace: input.birthPlace ?? null,
    birthDate: input.birthDate ?? null,
    address: input.address ?? null,
    guardianName: input.guardianName ?? null,
    guardianPhone: input.guardianPhone ?? null,
    classId: input.currentClassId ?? null,
    class: klass,
    schoolId: school.id,
    schoolActive: school.isActive,
    timezone: school.timezone,
    activeAcademicYearId: school.activeAcademicYearId,
  };
}

function studentData(scope: SchoolScope, input: CreateStudentInput, userId: string, now: Date) {
  return {
    userId,
    schoolId: scope.schoolId,
    nisn: input.nisn,
    activeNisn: input.activate ? input.nisn : null,
    nis: input.nis,
    gender: input.gender,
    birthPlace: input.birthPlace ?? null,
    birthDate: input.birthDate ? toDbDate(input.birthDate) : null,
    address: input.address ?? null,
    guardianName: input.guardianName ?? null,
    guardianPhone: input.guardianPhone ?? null,
    status: input.activate ? ("ACTIVE" as const) : ("DRAFT" as const),
    currentClassId: input.currentClassId ?? null,
    activatedAt: input.activate ? now : null,
    sppAmount: input.sppAmount ?? null,
  };
}

/** Sekolah & kelas yang valid SAAT INI; aktivasi wajib lengkap (422 tanpa menulis apa pun). */
async function checkAssignable(db: Tx, scope: SchoolScope, input: CreateStudentInput, now: Date): Promise<SchoolContext> {
  const school = await loadSchoolContext(db, scope);
  const klass = await resolveAssignableClass(db, scope, input.currentClassId ?? null);
  const gaps = getActivationGaps(toActivationInput(input, klass, school), now);
  if (input.activate && gaps.length > 0) throw activationIncomplete(gaps);
  return school;
}

async function insertStudent(
  tx: Tx,
  scope: SchoolScope,
  input: CreateStudentInput,
  credential: TemporaryCredential,
  ctx: ActionContext,
): Promise<{ id: string; nisnReleased: boolean }> {
  await lockForStudentWrite(tx, { classIds: [input.currentClassId], claimingSchoolId: input.activate ? scope.schoolId : null });
  const school = await checkAssignable(tx, scope, input, ctx.now);
  const policy = { confirmRelease: input.confirmReleaseGraduatedNisn, claimer: school };
  const released = input.activate ? await claimNisn(tx, { studentId: null, nisn: input.nisn }, ctx, policy) : null;
  const user = await tx.user.create({
    data: {
      role: "STUDENT",
      name: input.name,
      schoolId: scope.schoolId,
      passwordHash: credential.hash,
      isActive: input.activate,
      mustChangePassword: true,
      tempPasswordExpiresAt: credential.expiresAt,
    },
    select: { id: true },
  });
  const data = studentData(scope, input, user.id, ctx.now);
  const student = await tx.student.create({ data, select: { id: true } });
  await recordNisnReleases(tx, released ? [released] : [], school, ctx);
  const { userId: _userId, schoolId: _schoolId, ...snapshot } = data;
  await writeAudit(
    tx,
    { action: "student.create", entityType: "Student", entityId: student.id, schoolId: scope.schoolId, after: { ...snapshot, name: input.name, nisnReleased: released !== null } },
    ctx,
  );
  return { id: student.id, nisnReleased: released !== null };
}

export async function createStudent(ctx: ActionContext, schoolId: string | undefined, input: CreateStudentInput): Promise<CreateStudentResult> {
  const scope = scopeFor(ctx, schoolId);
  await checkAssignable(prisma, scope, input, ctx.now);
  await assertIdentityFree(prisma, scope, { nisn: input.nisn, nis: input.nis });
  const credential = await issueTemporaryPassword(ctx.now);
  const created = await withStudentConflicts(() => withTx((tx) => insertStudent(tx, scope, input, credential, ctx)));
  return {
    student: await loadStudentDetail(scope, created.id, ctx.now),
    temporaryPassword: credential.plain,
    tempPasswordExpiresAt: credential.expiresAt.toISOString(),
    nisnReleased: created.nisnReleased,
  };
}
