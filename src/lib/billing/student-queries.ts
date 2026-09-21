import type { Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { pageMeta } from "@/lib/http/envelope";
import { toSkipTake } from "@/lib/http/pagination";
import { studentSelf } from "@/lib/tenant/scope";
import { HISTORY_LIMIT, type StudentInvoiceFilter } from "./constants";
import { loadBillingSchool, schoolClock } from "./context";
import { INVOICE_SELECT, SUBMISSION_SUMMARY_SELECT, toStudentInvoiceDto, toSubmissionSummary } from "./dto";
import { invoiceNotFound, submissionNotFound } from "./locks";
import { buildPaymentInfo } from "./payment-info-rules";
import type {
  PaymentInfoDto,
  StudentInvoiceDetailDto,
  StudentInvoiceDto,
  StudentInvoicesMeta,
  SubmissionSummaryDto,
} from "./response-schemas";
import type { StudentInvoicesQuery } from "./schemas";

/** Tampilan SPP milik siswa sendiri (id tidak pernah dari body; tagihan siswa lain -> 404). */

export interface StudentSelf {
  readonly schoolId: string;
  readonly studentId: string;
  readonly userId: string;
}

export const selfOf = (ctx: ActionContext): StudentSelf => studentSelf(requirePrincipal(ctx));

function filterWhere(filter: StudentInvoiceFilter): Prisma.InvoiceWhereInput {
  if (filter === "OUTSTANDING") return { status: { in: ["UNPAID", "PARTIAL"] } };
  if (filter === "PAID") return { status: "PAID" };
  return { status: { not: "VOID" } };
}

async function outstandingSummary(self: StudentSelf): Promise<StudentInvoicesMeta["summary"]> {
  const agg = await prisma.invoice.aggregate({
    where: { schoolId: self.schoolId, studentId: self.studentId, status: { in: ["UNPAID", "PARTIAL"] } },
    _sum: { amount: true, paidAmount: true },
    _count: { _all: true },
  });
  return { outstandingAmount: (agg._sum.amount ?? 0) - (agg._sum.paidAmount ?? 0), outstandingCount: agg._count._all };
}

/** GET /student/invoices: VOID tidak ditampilkan; OUTSTANDING urut jatuh tempo terdekat, lainnya periode terbaru. */
export async function listMyInvoices(ctx: ActionContext, query: StudentInvoicesQuery): Promise<{ data: StudentInvoiceDto[]; meta: StudentInvoicesMeta }> {
  const self = selfOf(ctx);
  const school = await loadBillingSchool(prisma, self.schoolId);
  const { today } = schoolClock(school, ctx.now);
  const where = { schoolId: self.schoolId, studentId: self.studentId, ...filterWhere(query.filter) };
  const orderBy: Prisma.InvoiceOrderByWithRelationInput[] =
    query.filter === "OUTSTANDING"
      ? [{ dueDate: "asc" }, { periodYear: "asc" }, { periodMonth: "asc" }, { id: "asc" }]
      : [{ periodYear: "desc" }, { periodMonth: "desc" }, { id: "desc" }];
  const [total, rows, summary] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({ where, orderBy, ...toSkipTake(query), select: INVOICE_SELECT }),
    outstandingSummary(self),
  ]);
  return { data: rows.map((row) => toStudentInvoiceDto(row, today)), meta: { ...pageMeta(total, query.page, query.limit), summary } };
}

/** GET /student/invoices/{id}: + pembayaran, riwayat bukti, rekening SPP sekolah. */
export async function getMyInvoice(ctx: ActionContext, id: string): Promise<StudentInvoiceDetailDto> {
  const self = selfOf(ctx);
  const school = await loadBillingSchool(prisma, self.schoolId);
  const { today } = schoolClock(school, ctx.now);
  const row = await prisma.invoice.findFirst({
    where: { id, schoolId: self.schoolId, studentId: self.studentId },
    select: {
      ...INVOICE_SELECT,
      payments: {
        select: { id: true, receiptNo: true, amount: true, method: true, paidDate: true, voidedAt: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: HISTORY_LIMIT,
      },
      submissions: { select: SUBMISSION_SUMMARY_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: HISTORY_LIMIT },
    },
  });
  if (!row) throw invoiceNotFound();
  return {
    ...toStudentInvoiceDto(row, today),
    note: row.note,
    paidAt: row.paidAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    payments: row.payments.map((p) => ({
      id: p.id, receiptNo: p.receiptNo, amount: p.amount, method: p.method, paidDate: p.paidDate.toISOString().slice(0, 10),
      voided: p.voidedAt !== null, createdAt: p.createdAt.toISOString(),
    })),
    submissions: row.submissions.map(toSubmissionSummary),
    bankAccount: buildPaymentInfo(school, ctx.now, school.timezone),
  };
}

/** GET /student/payment-info: rekening SPP sekolah + penanda rekening baru berubah (14 hari). */
export async function getMyPaymentInfo(ctx: ActionContext): Promise<PaymentInfoDto> {
  const self = selfOf(ctx);
  const school = await loadBillingSchool(prisma, self.schoolId);
  return buildPaymentInfo(school, ctx.now, school.timezone);
}

export async function loadOwnSubmission(db: Tx, self: StudentSelf, id: string): Promise<SubmissionSummaryDto> {
  const row = await db.paymentSubmission.findFirst({
    where: { id, schoolId: self.schoolId, studentId: self.studentId },
    select: SUBMISSION_SUMMARY_SELECT,
  });
  if (!row) throw submissionNotFound();
  return toSubmissionSummary(row);
}
