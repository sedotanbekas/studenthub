import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { withTx } from "@/lib/tx";
import { eligibleIds, findClass, loadClassSubject, loadMappedSubjects, loadRoster, loadTermClass, scopeOf, type ClassRow, type TermRow } from "./context";
import { loadReportCardDetail } from "./detail";
import { cardSubjectErrors, duplicateStudentErrors, eligibilityErrors, planGradeWrites, type GradePlan, type GradeWrite } from "./grade-plan";
import {
  applyGradePlan,
  assertNoRowErrors,
  assertNonePublished,
  loadExistingGrades,
  loadSubjectInfo,
  lockCardRows,
  lockGrades,
  refreshClassSnapshot,
} from "./grade-writes";
import type { BulkGradesInput, BulkGradesResultDto, CardGradesInput, ReportCardDetailDto } from "./schemas";

/**
 * Input nilai rapor (desain 03 §E.4–E.6). Semua-atau-tidak: validasi seluruh payload (400 rowErrors),
 * rapor terbit -> 409, lalu buat rapor yang belum ada (lazy) dan upsert nilai per [rapor, mapel].
 */
interface ClassGradeTarget {
  readonly term: TermRow;
  readonly klass: ClassRow;
  readonly subject: { readonly id: string; readonly name: string; readonly kkm: number };
}

async function loadClassGradeTarget(tx: Tx, scope: SchoolScope, input: BulkGradesInput): Promise<ClassGradeTarget> {
  const { term, klass } = await loadTermClass(tx, scope, input.termId, input.classId);
  const subject = await loadClassSubject(tx, scope, klass.id, input.subjectId);
  return { term, klass, subject };
}

/** Rapor DRAFT baru untuk siswa yang diberi nilai tetapi belum punya rapor kelas & semester ini. */
async function createMissingCards(tx: Tx, scope: SchoolScope, target: ClassGradeTarget, studentIds: readonly string[]): Promise<Map<string, string>> {
  if (studentIds.length === 0) return new Map();
  await tx.reportCard.createMany({
    data: studentIds.map((studentId) => ({
      schoolId: scope.schoolId, studentId, termId: target.term.id, classId: target.klass.id, classNameSnapshot: target.klass.name,
    })),
  });
  const rows = await tx.reportCard.findMany({
    where: { schoolId: scope.schoolId, termId: target.term.id, studentId: { in: [...studentIds] } },
    select: { id: true, studentId: true },
  });
  return new Map(rows.map((r) => [r.studentId, r.id]));
}

async function writeClassGrades(tx: Tx, scope: SchoolScope, target: ClassGradeTarget, input: BulkGradesInput): Promise<{ plan: GradePlan; created: number }> {
  const studentIds = input.entries.map((e) => e.studentId);
  const cardIds = (await tx.reportCard.findMany({
    where: { schoolId: scope.schoolId, termId: target.term.id, classId: target.klass.id, studentId: { in: studentIds } },
    select: { id: true },
  })).map((c) => c.id);
  const cards = await lockCardRows(tx, scope, cardIds);
  assertNonePublished(cards);
  const hasCard = new Set(cards.map((c) => c.studentId));
  const toCreate = input.entries.filter((e) => e.score !== null && !hasCard.has(e.studentId)).map((e) => e.studentId);
  const created = await createMissingCards(tx, scope, target, toCreate);
  await refreshClassSnapshot(tx, cardIds, target.klass.name);
  const cardOf = new Map([...cards.map((c) => [c.studentId, c.id] as const), ...created]);
  const writes: GradeWrite[] = input.entries.flatMap((e) => {
    const reportCardId = cardOf.get(e.studentId);
    return reportCardId ? [{ reportCardId, subjectId: target.subject.id, score: e.score, description: e.description }] : [];
  });
  const existing = await loadExistingGrades(tx, [...cardOf.values()], [target.subject.id]);
  const plan = planGradeWrites(writes, existing, new Map([[target.subject.id, { ...target.subject }]]));
  await applyGradePlan(tx, plan);
  return { plan, created: created.size };
}

/** PUT /school/report-cards/grades: satu kelas & satu mapel, maks 100 baris. */
export async function upsertClassGrades(ctx: ActionContext, schoolId: string | undefined, input: BulkGradesInput): Promise<BulkGradesResultDto> {
  const scope = scopeOf(ctx, schoolId);
  assertNoRowErrors(duplicateStudentErrors(input.entries));
  // Cek keberadaan sebelum transaksi agar kunci aplikasi tidak dibuat untuk id sembarang; dicek ulang di bawah kunci.
  await loadTermClass(prisma, scope, input.termId, input.classId);
  return withTx(async (tx) => {
    await lockGrades(tx, input.termId, input.classId);
    const target = await loadClassGradeTarget(tx, scope, input);
    const roster = await loadRoster(tx, scope, target.term, target.klass);
    assertNoRowErrors(eligibilityErrors(input.entries, { eligible: eligibleIds(roster), otherClass: roster.otherClass }));
    const { plan, created } = await writeClassGrades(tx, scope, target, input);
    const result = { updated: plan.creates.length + plan.updates.length, unchanged: plan.unchanged, deleted: plan.deleteIds.length, createdReportCards: created };
    await writeAudit(
      tx,
      {
        action: "report_card.grades_upsert",
        entityType: "SchoolClass",
        entityId: target.klass.id,
        schoolId: scope.schoolId,
        after: { termId: target.term.id, subjectId: target.subject.id, count: input.entries.length, ...result },
      },
      ctx,
    );
    return result;
  });
}

// ----------------------------------------------------------------------------- satu rapor

async function writeCardGrades(tx: Tx, scope: SchoolScope, card: { id: string; classId: string }, input: CardGradesInput): Promise<GradePlan> {
  const mapped = await loadMappedSubjects(tx, card.classId);
  const existing = await loadExistingGrades(tx, [card.id]);
  assertNoRowErrors(cardSubjectErrors(input.grades, new Set(mapped.map((m) => m.subjectId)), new Set(existing.map((g) => g.subjectId))));
  const subjects = await loadSubjectInfo(tx, scope, input.grades.map((g) => g.subjectId));
  const klass = await findClass(tx, scope, card.classId);
  await refreshClassSnapshot(tx, [card.id], klass.name);
  const writes = input.grades.map((g) => ({ reportCardId: card.id, subjectId: g.subjectId, score: g.score, description: g.description }));
  const plan = planGradeWrites(writes, existing, subjects);
  await applyGradePlan(tx, plan);
  return plan;
}

/** PUT /school/report-cards/{id}/grades: mapel terpetakan atau yang sudah dinilai di rapor ini, maks 40. */
export async function upsertCardGrades(ctx: ActionContext, schoolId: string | undefined, id: string, input: CardGradesInput): Promise<ReportCardDetailDto> {
  const scope = scopeOf(ctx, schoolId);
  const ref = await prisma.reportCard.findFirst({ where: { id, schoolId: scope.schoolId }, select: { termId: true, classId: true } });
  if (!ref) throw notFound("Rapor tidak ditemukan.");
  return withTx(async (tx) => {
    await lockGrades(tx, ref.termId, ref.classId);
    const [card] = await lockCardRows(tx, scope, [id]);
    if (!card) throw notFound("Rapor tidak ditemukan.");
    assertNonePublished([card]);
    const plan = await writeCardGrades(tx, scope, card, input);
    await writeAudit(
      tx,
      {
        action: "report_card.grades_upsert",
        entityType: "ReportCard",
        entityId: card.id,
        schoolId: scope.schoolId,
        after: { subjectIds: input.grades.map((g) => g.subjectId), updated: plan.creates.length + plan.updates.length, deleted: plan.deleteIds.length },
      },
      ctx,
    );
    return loadReportCardDetail(tx, scope, card.id, ctx.now);
  });
}
