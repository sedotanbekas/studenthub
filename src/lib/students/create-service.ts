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
import { claimNisn, recordNisnReleases } from "./nisn-claim";
import { loadSchoolContext, scopeFor, type ClassRef, type SchoolContext } from "./records";
import { loadStudentDetail } from "./queries";
import type { CreateStudentInput, StudentDetail } from "./schemas";

/**
 * Buat siswa (POST /school/students). activate=true (default): data wajib harus lengkap (422
 * ACTIVATION_INCOMPLETE, TANPA tulis apa pun), NISN diklaim, status ACTIVE. activate=false: DRAFT,
 * User.isActive=false, activeNisn NULL. Kata sandi awal SELALU di-generate dan dikembalikan sekali.
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

async function insertStudent(
  tx: Tx,
  scope: SchoolScope,
  input: CreateStudentInput,
  credential: TemporaryCredential,
  ctx: ActionContext,
): Promise<{ id: string; nisnReleased: boolean }> {
  const released = input.activate ? await claimNisn(tx, { studentId: null, nisn: input.nisn }, ctx) : null;
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
  await recordNisnReleases(tx, released ? [released] : [], ctx);
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
  const school = await loadSchoolContext(prisma, scope);
  const klass = await resolveAssignableClass(prisma, scope, input.currentClassId ?? null);
  await assertIdentityFree(prisma, scope, { nisn: input.nisn, nis: input.nis });
  const gaps = getActivationGaps(toActivationInput(input, klass, school), ctx.now);
  if (input.activate && gaps.length > 0) throw activationIncomplete(gaps);
  const credential = await issueTemporaryPassword(ctx.now);
  const created = await withStudentConflicts(() => withTx((tx) => insertStudent(tx, scope, input, credential, ctx)));
  return {
    student: await loadStudentDetail(scope, created.id, ctx.now),
    temporaryPassword: credential.plain,
    tempPasswordExpiresAt: credential.expiresAt.toISOString(),
    nisnReleased: created.nisnReleased,
  };
}
