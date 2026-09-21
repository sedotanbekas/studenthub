import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import { NEAR_DUPLICATE_MAX_DISTANCE } from "@/lib/storage/phash";
import { DUPLICATE_CANDIDATE_LIMIT, DUPLICATE_LOOKBACK_DAYS, HISTORY_LIMIT } from "./constants";
import { billingScopeOf, loadBillingSchool } from "./context";
import { STUDENT_REF_SELECT, SUBMISSION_SUMMARY_SELECT, toStudentRef, toSubmissionSummary } from "./dto";
import { findNearDuplicates, type ProofCandidate } from "./duplicate-rules";
import { remainingOf } from "./invoice-status";
import { submissionNotFound } from "./locks";
import type { AdminSubmissionDetailDto, AdminSubmissionDto } from "./response-schemas";
import type { ListSubmissionsQuery } from "./schemas";

/** Antrean & detail bukti transfer untuk admin + penanda bukti mirip (dHash) dalam sekolah yang sama. */

const DAY_MS = 86_400_000;

export const ADMIN_SUBMISSION_SELECT = {
  ...SUBMISSION_SUMMARY_SELECT,
  invoice: { select: { id: true, invoiceNo: true, title: true, amount: true, paidAmount: true, status: true } },
  student: { select: STUDENT_REF_SELECT },
  proofFile: { select: { id: true, phash: true } },
} as const satisfies Prisma.PaymentSubmissionSelect;

type AdminSubmissionRow = Prisma.PaymentSubmissionGetPayload<{ select: typeof ADMIN_SUBMISSION_SELECT }>;

/** Kandidat pembanding: bukti PAYMENT_PROOF sekolah ini (365 hari terakhir, maks 5.000 terbaru). */
async function loadProofCandidates(db: Tx, schoolId: string, now: Date): Promise<ProofCandidate[]> {
  const rows = await db.storedFile.findMany({
    where: { schoolId, kind: "PAYMENT_PROOF", phash: { not: null }, createdAt: { gte: new Date(now.getTime() - DUPLICATE_LOOKBACK_DAYS * DAY_MS) } },
    select: { id: true, phash: true, paymentSubmission: { select: { id: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: DUPLICATE_CANDIDATE_LIMIT,
  });
  return rows.map((r) => ({ fileId: r.id, phash: r.phash, submissionId: r.paymentSubmission?.id ?? null }));
}

function toAdminSubmission(row: AdminSubmissionRow, candidates: readonly ProofCandidate[]): AdminSubmissionDto {
  const { invoice, student, proofFile } = row;
  return {
    ...toSubmissionSummary(row),
    invoice: { ...invoice, remaining: remainingOf(invoice) },
    student: toStudentRef(student),
    possibleDuplicateOf: findNearDuplicates({ fileId: proofFile.id, phash: proofFile.phash }, candidates, NEAR_DUPLICATE_MAX_DISTANCE),
  };
}

function listWhere(schoolId: string, query: ListSubmissionsQuery): Prisma.PaymentSubmissionWhereInput {
  const term = likeSearch(query.q);
  return {
    schoolId,
    ...(query.status === "ALL" ? {} : { status: query.status }),
    ...(query.classId ? { student: { currentClassId: query.classId } } : {}),
    ...(term
      ? {
          OR: [
            { student: { user: { name: { contains: term } } } },
            { student: { nis: { startsWith: term } } },
            { invoice: { invoiceNo: { startsWith: term } } },
          ],
        }
      : {}),
  };
}

/** GET /school/payment-submissions: default PENDING terlama dulu (antrean), selain itu terbaru dulu. */
export async function listSubmissions(ctx: ActionContext, query: ListSubmissionsQuery): Promise<{ data: AdminSubmissionDto[]; meta: PageMeta }> {
  const scope = billingScopeOf(ctx, query.schoolId);
  await loadBillingSchool(prisma, scope.schoolId);
  const where = listWhere(scope.schoolId, query);
  const direction = query.status === "PENDING" ? "asc" : "desc";
  const [total, rows] = await Promise.all([
    prisma.paymentSubmission.count({ where }),
    prisma.paymentSubmission.findMany({
      where,
      orderBy: [{ createdAt: direction }, { id: direction }],
      ...toSkipTake(query),
      select: ADMIN_SUBMISSION_SELECT,
    }),
  ]);
  const candidates = rows.length > 0 ? await loadProofCandidates(prisma, scope.schoolId, ctx.now) : [];
  return { data: rows.map((row) => toAdminSubmission(row, candidates)), meta: pageMeta(total, query.page, query.limit) };
}

/** Satu pengajuan dalam cakupan sebagai DTO antrean (dipakai juga setelah approve/reject). */
export async function loadAdminSubmission(db: Tx, schoolId: string, id: string, now: Date): Promise<AdminSubmissionDto> {
  const row = await db.paymentSubmission.findFirst({ where: { id, schoolId }, select: ADMIN_SUBMISSION_SELECT });
  if (!row) throw submissionNotFound();
  return toAdminSubmission(row, await loadProofCandidates(db, schoolId, now));
}

/** GET /school/payment-submissions/{id}: + peninjau, pembayaran hasil persetujuan, riwayat pengajuan tagihan. */
export async function getSubmissionDetail(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<AdminSubmissionDetailDto> {
  const scope = billingScopeOf(ctx, schoolId);
  await loadBillingSchool(prisma, scope.schoolId);
  const row = await prisma.paymentSubmission.findFirst({
    where: { id, schoolId: scope.schoolId },
    select: {
      ...ADMIN_SUBMISSION_SELECT,
      reviewedBy: { select: { id: true, name: true } },
      payment: { select: { id: true, receiptNo: true, amount: true, voidedAt: true } },
    },
  });
  if (!row) throw submissionNotFound();
  const history = await prisma.paymentSubmission.findMany({
    where: { schoolId: scope.schoolId, invoiceId: row.invoiceId, id: { not: id } },
    select: SUBMISSION_SUMMARY_SELECT,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: HISTORY_LIMIT,
  });
  const { payment } = row;
  return {
    ...toAdminSubmission(row, await loadProofCandidates(prisma, scope.schoolId, ctx.now)),
    reviewedBy: row.reviewedBy,
    payment: payment ? { id: payment.id, receiptNo: payment.receiptNo, amount: payment.amount, voided: payment.voidedAt !== null } : null,
    history: history.map(toSubmissionSummary),
  };
}
