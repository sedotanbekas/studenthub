import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import { HISTORY_LIMIT } from "./constants";
import { billingScopeOf, loadBillingSchool } from "./context";
import { STUDENT_REF_SELECT, SUBMISSION_SUMMARY_SELECT, toStudentRef, toSubmissionSummary } from "./dto";
import { findPossibleDuplicates } from "./duplicate-queries";
import { remainingOf } from "./invoice-status";
import { submissionNotFound } from "./locks";
import type { AdminSubmissionDetailDto, AdminSubmissionDto } from "./response-schemas";
import type { ListSubmissionsQuery } from "./schemas";

/**
 * Antrean & detail bukti transfer untuk admin + penanda bukti identik/mirip dalam sekolah yang sama
 * (dihitung sekali saat unggah & disimpan di PaymentProofMatch, maks 5 per pengajuan — lihat duplicate-queries).
 */

export const ADMIN_SUBMISSION_SELECT = {
  ...SUBMISSION_SUMMARY_SELECT,
  invoice: { select: { id: true, invoiceNo: true, title: true, amount: true, paidAmount: true, status: true } },
  student: { select: STUDENT_REF_SELECT },
} as const satisfies Prisma.PaymentSubmissionSelect;

type AdminSubmissionRow = Prisma.PaymentSubmissionGetPayload<{ select: typeof ADMIN_SUBMISSION_SELECT }>;

function toAdminSubmission(row: AdminSubmissionRow, duplicates: ReadonlyMap<string, readonly string[]>): AdminSubmissionDto {
  const { invoice, student } = row;
  return {
    ...toSubmissionSummary(row),
    invoice: { ...invoice, remaining: remainingOf(invoice) },
    student: toStudentRef(student),
    possibleDuplicateOf: [...(duplicates.get(row.id) ?? [])],
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
  const duplicates = await findPossibleDuplicates(prisma, scope.schoolId, rows.map((row) => row.id));
  return { data: rows.map((row) => toAdminSubmission(row, duplicates)), meta: pageMeta(total, query.page, query.limit) };
}

/** Satu pengajuan dalam cakupan sebagai DTO antrean (dipakai juga setelah approve/reject). */
export async function loadAdminSubmission(db: Tx, schoolId: string, id: string): Promise<AdminSubmissionDto> {
  const row = await db.paymentSubmission.findFirst({ where: { id, schoolId }, select: ADMIN_SUBMISSION_SELECT });
  if (!row) throw submissionNotFound();
  return toAdminSubmission(row, await findPossibleDuplicates(db, schoolId, [row.id]));
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
    ...toAdminSubmission(row, await findPossibleDuplicates(prisma, scope.schoolId, [row.id])),
    reviewedBy: row.reviewedBy,
    payment: payment ? { id: payment.id, receiptNo: payment.receiptNo, amount: payment.amount, voided: payment.voidedAt !== null } : null,
    history: history.map(toSubmissionSummary),
  };
}
