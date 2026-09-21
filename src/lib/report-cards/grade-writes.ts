import type { ReportCardStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { badRequest, conflict } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import { lockKey, lockRows } from "@/lib/tx";
import { gradesLockKey } from "./constants";
import type { ExistingGrade, GradePlan, GradeRowError, SubjectInfo } from "./grade-plan";

/**
 * Penulisan nilai & kunci rapor bersama (bulk per kelas-mapel dan per rapor).
 * Urutan kunci: AppLock `grades:<termId>:<classId>` -> ReportCard (id naik) FOR UPDATE -> tulis -> audit.
 */
export interface LockedCard {
  readonly id: string;
  readonly studentId: string;
  readonly termId: string;
  readonly classId: string;
  readonly status: ReportCardStatus;
}

export async function lockGrades(tx: Tx, termId: string, classId: string): Promise<void> {
  await lockKey(tx, gradesLockKey(termId, classId));
}

/** FOR UPDATE atas rapor (id naik) lalu baca ulang statusnya. */
export async function lockCardRows(tx: Tx, scope: SchoolScope, ids: readonly string[]): Promise<LockedCard[]> {
  if (ids.length === 0) return [];
  await lockRows(tx, "ReportCard", ids);
  return tx.reportCard.findMany({
    where: { id: { in: [...ids] }, schoolId: scope.schoolId },
    select: { id: true, studentId: true, termId: true, classId: true, status: true },
    orderBy: { id: "asc" },
  });
}

/** 400 dengan rowErrors; tidak ada yang ditulis (transaksi di-rollback). */
export function assertNoRowErrors(errors: readonly GradeRowError[]): void {
  if (errors.length === 0) return;
  throw badRequest("GRADE_ROWS_INVALID", `${errors.length} baris nilai tidak valid; tidak ada nilai yang disimpan.`, { rowErrors: errors });
}

/** Rapor terbit tidak boleh diubah: 409 REPORT_CARD_PUBLISHED {studentIds}. */
export function assertNonePublished(cards: ReadonlyArray<{ readonly studentId: string; readonly status: ReportCardStatus }>): void {
  const studentIds = cards.filter((c) => c.status === "PUBLISHED").map((c) => c.studentId);
  if (studentIds.length === 0) return;
  throw conflict("REPORT_CARD_PUBLISHED", "Rapor yang sudah terbit tidak dapat diubah. Tarik terbit terlebih dahulu.", { studentIds });
}

const EXISTING_SELECT = {
  id: true, reportCardId: true, subjectId: true, subjectNameSnapshot: true, kkmSnapshot: true, score: true, predicate: true, description: true,
} as const;

export async function loadExistingGrades(tx: Tx, reportCardIds: readonly string[], subjectIds?: readonly string[]): Promise<ExistingGrade[]> {
  if (reportCardIds.length === 0) return [];
  return tx.reportCardGrade.findMany({
    where: { reportCardId: { in: [...reportCardIds] }, ...(subjectIds ? { subjectId: { in: [...subjectIds] } } : {}) },
    select: EXISTING_SELECT,
  });
}

/** Mapel milik sekolah untuk snapshot (nama & KKM terkini). */
export async function loadSubjectInfo(tx: Tx, scope: SchoolScope, subjectIds: readonly string[]): Promise<Map<string, SubjectInfo>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await tx.subject.findMany({ where: { id: { in: [...new Set(subjectIds)] }, schoolId: scope.schoolId }, select: { id: true, name: true, kkm: true } });
  return new Map(rows.map((r) => [r.id, r]));
}

export async function applyGradePlan(tx: Tx, plan: GradePlan): Promise<void> {
  if (plan.creates.length > 0) await tx.reportCardGrade.createMany({ data: plan.creates });
  for (const update of plan.updates) await tx.reportCardGrade.update({ where: { id: update.id }, data: update.data });
  if (plan.deleteIds.length > 0) await tx.reportCardGrade.deleteMany({ where: { id: { in: plan.deleteIds } } });
}

/** Snapshot nama kelas disegarkan pada setiap tulis selama DRAFT. */
export async function refreshClassSnapshot(tx: Tx, cardIds: readonly string[], className: string): Promise<void> {
  if (cardIds.length === 0) return;
  await tx.reportCard.updateMany({
    where: { id: { in: [...cardIds] }, status: "DRAFT", classNameSnapshot: { not: className } },
    data: { classNameSnapshot: className },
  });
}
