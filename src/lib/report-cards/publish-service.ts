import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { notifyRecipients, type NotifyContext } from "@/lib/notifications/notify";
import { reportCardPublishedNotification } from "@/lib/notifications/templates/report-cards";
import type { SchoolScope } from "@/lib/tenant/scope";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import { termAttendanceByStudent } from "./attendance";
import { gradesLockKey } from "./constants";
import {
  groupBy,
  loadCardGrades,
  loadMappedSubjects,
  loadRoster,
  loadSchoolClock,
  loadTermClass,
  scopeOf,
  studentsWithCard,
  type RosterCard,
  type TermRow,
} from "./context";
import { groupAttendanceSnapshots, groupGradeRefresh } from "./grade-plan";
import { loadSubjectInfo, lockCardRows, lockGrades } from "./grade-writes";
import { selectPublishTargets } from "./rules";
import type { PublishInput, PublishResultDto, UnpublishInput, UnpublishResultDto } from "./schemas";

/**
 * Terbit & tarik terbit rapor (desain 03 §E.8–E.9). Terbit per kelas, semua-atau-tidak (422
 * REPORT_CARD_INCOMPLETE), snapshot mapel/KKM/predikat & rekap kehadiran dibekukan, CAS DRAFT->PUBLISHED,
 * notifikasi siswa + audit di transaksi yang sama. Tarik terbit wajib alasan, tanpa notifikasi.
 */
const PUBLISH_TX_TIMEOUT_MS = 60_000;
const stateConflict = () => conflict("STATE_CONFLICT", "Status rapor berubah bersamaan. Silakan ulangi.");

/** Snapshot nama mapel, KKM, dan predikat dihitung ulang dari mapel terkini. */
async function refreshGradeSnapshots(tx: Tx, scope: SchoolScope, cardIds: readonly string[]): Promise<void> {
  const grades = await tx.reportCardGrade.findMany({ where: { reportCardId: { in: [...cardIds] } }, select: { id: true, subjectId: true, score: true } });
  const subjects = await loadSubjectInfo(tx, scope, grades.map((g) => g.subjectId));
  for (const group of groupGradeRefresh(grades, subjects)) {
    const { ids, ...data } = group;
    await tx.reportCardGrade.updateMany({ where: { id: { in: ids } }, data });
  }
}

/** CAS DRAFT -> PUBLISHED sekaligus menulis rekap sakit/izin/alpha. Jumlah berbeda -> 409 (rollback). */
async function markPublished(tx: Tx, scope: SchoolScope, term: TermRow, cards: readonly RosterCard[], ctx: ActionContext): Promise<void> {
  const clock = await loadSchoolClock(tx, scope);
  const summaries = await termAttendanceByStudent(tx, scope, term, clock, cards.map((c) => c.studentId), ctx.now);
  const publishedById = requirePrincipal(ctx).userId;
  let updated = 0;
  for (const { ids, ...snapshot } of groupAttendanceSnapshots(cards, summaries)) {
    const result = await tx.reportCard.updateMany({
      where: { id: { in: ids }, schoolId: scope.schoolId, status: "DRAFT" },
      data: { ...snapshot, status: "PUBLISHED", publishedAt: ctx.now, publishedById },
    });
    updated += result.count;
  }
  if (updated !== cards.length) throw stateConflict();
}

/** Satu jadwal kick push per request walau notifikasi dibuat per rapor. */
function onceDeferContext(ctx: ActionContext): NotifyContext {
  const scheduled = new Set<() => Promise<void>>();
  return {
    now: ctx.now,
    defer: (task) => {
      if (scheduled.has(task)) return;
      scheduled.add(task);
      ctx.defer(task);
    },
  };
}

async function notifyPublished(tx: Tx, scope: SchoolScope, term: TermRow, cards: readonly RosterCard[], ctx: ActionContext): Promise<number> {
  const students = await tx.student.findMany({
    where: { id: { in: cards.map((c) => c.studentId) }, schoolId: scope.schoolId, user: { isActive: true } },
    select: { id: true, userId: true },
  });
  const userOf = new Map(students.map((s) => [s.id, s.userId]));
  const notifyCtx = onceDeferContext(ctx);
  let notified = 0;
  for (const card of cards) {
    const userId = userOf.get(card.studentId);
    if (!userId) continue;
    const event = reportCardPublishedNotification({ reportCardId: card.id, termLabel: term.label, republished: card.publishedBefore });
    notified += await notifyRecipients(tx, [{ userId, role: "STUDENT" }], event, notifyCtx);
  }
  return notified;
}

async function selectTargets(tx: Tx, scope: SchoolScope, input: PublishInput): Promise<{ term: TermRow; classId: string; cards: RosterCard[] }> {
  const { term, klass } = await loadTermClass(tx, scope, input.termId, input.classId);
  const mapped = await loadMappedSubjects(tx, klass.id);
  if (mapped.length === 0) throw unprocessable("CLASS_HAS_NO_SUBJECTS", "Kelas belum memiliki mapel terpetakan; rapor tidak dapat diterbitkan.");
  const roster = await loadRoster(tx, scope, term, klass);
  await lockRows(tx, "ReportCard", roster.cards.map((c) => c.id));
  const withCard = studentsWithCard(roster);
  const selection = selectPublishTargets({
    mapped,
    cards: await loadCardGrades(tx, roster.cards),
    requestedStudentIds: input.studentIds ?? null,
    activeWithoutCard: roster.activeInClassIds.filter((id) => !withCard.has(id)),
  });
  if (selection.incomplete.length > 0) {
    throw unprocessable("REPORT_CARD_INCOMPLETE", `${selection.incomplete.length} siswa belum lengkap nilainya; tidak ada rapor yang diterbitkan.`, {
      incomplete: selection.incomplete,
    });
  }
  const chosen = new Set(selection.toPublish.map((c) => c.reportCardId));
  return { term, classId: klass.id, cards: roster.cards.filter((c) => chosen.has(c.id)) };
}

/** POST /school/report-cards/publish. */
export async function publishReportCards(ctx: ActionContext, schoolId: string | undefined, input: PublishInput): Promise<PublishResultDto> {
  const scope = scopeOf(ctx, schoolId);
  await loadTermClass(prisma, scope, input.termId, input.classId);
  return withTx(async (tx) => {
    await lockGrades(tx, input.termId, input.classId);
    const { term, classId, cards } = await selectTargets(tx, scope, input);
    if (cards.length === 0) return { publishedIds: [], notified: 0 };
    const ids = cards.map((c) => c.id);
    await refreshGradeSnapshots(tx, scope, ids);
    await markPublished(tx, scope, term, cards, ctx);
    const notified = await notifyPublished(tx, scope, term, cards, ctx);
    await writeAudit(
      tx,
      { action: "report_card.publish", entityType: "SchoolClass", entityId: classId, schoolId: scope.schoolId, after: { termId: term.id, reportCardIds: ids, notified } },
      ctx,
    );
    return { publishedIds: ids, notified };
  }, { timeout: PUBLISH_TX_TIMEOUT_MS });
}

// ----------------------------------------------------------------------------- tarik terbit

async function unpublishInTx(tx: Tx, scope: SchoolScope, ids: readonly string[], lockKeys: readonly string[], input: UnpublishInput, ctx: ActionContext): Promise<void> {
  for (const key of lockKeys) await lockKey(tx, key);
  const cards = await lockCardRows(tx, scope, ids);
  if (cards.length !== ids.length) throw notFound("Rapor tidak ditemukan.");
  const notPublished = cards.filter((c) => c.status !== "PUBLISHED").map((c) => c.id);
  if (notPublished.length > 0) throw conflict("REPORT_CARD_NOT_PUBLISHED", "Hanya rapor yang sudah terbit yang dapat ditarik.", { reportCardIds: notPublished });
  const { count } = await tx.reportCard.updateMany({
    where: { id: { in: [...ids] }, schoolId: scope.schoolId, status: "PUBLISHED" },
    data: { status: "DRAFT", publishedAt: null, publishedById: null },
  });
  if (count !== ids.length) throw stateConflict();
  for (const group of groupBy(cards, (c) => `${c.termId}:${c.classId}`).values()) {
    const [first] = group;
    if (!first) continue;
    await writeAudit(
      tx,
      {
        action: "report_card.unpublish",
        entityType: "SchoolClass",
        entityId: first.classId,
        schoolId: scope.schoolId,
        after: { termId: first.termId, reportCardIds: group.map((c) => c.id), reason: input.reason },
      },
      ctx,
    );
  }
}

/** POST /school/report-cards/unpublish: CAS PUBLISHED -> DRAFT (rekap kehadiran lama dipertahankan sebagai penanda pernah terbit). */
export async function unpublishReportCards(ctx: ActionContext, schoolId: string | undefined, input: UnpublishInput): Promise<UnpublishResultDto> {
  const scope = scopeOf(ctx, schoolId);
  const ids = [...new Set(input.reportCardIds)].sort();
  const refs = await prisma.reportCard.findMany({ where: { id: { in: ids }, schoolId: scope.schoolId }, select: { termId: true, classId: true } });
  if (refs.length !== ids.length) throw notFound("Rapor tidak ditemukan.");
  const lockKeys = [...new Set(refs.map((r) => gradesLockKey(r.termId, r.classId)))].sort();
  await withTx((tx) => unpublishInTx(tx, scope, ids, lockKeys, input, ctx));
  return { unpublishedIds: ids };
}
