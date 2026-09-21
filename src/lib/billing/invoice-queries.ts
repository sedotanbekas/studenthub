import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import type { SchoolScope } from "@/lib/tenant/scope";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { HISTORY_LIMIT, type InvoiceStatusFilter } from "./constants";
import { billingScopeOf, loadBillingSchool, schoolClock } from "./context";
import {
  INVOICE_SELECT,
  PAYMENT_SELECT,
  SUBMISSION_SUMMARY_SELECT,
  toInvoiceDto,
  toPaymentDto,
  toSubmissionSummary,
} from "./dto";
import { invoiceNotFound } from "./locks";
import type { InvoiceDetailDto, InvoiceDto } from "./response-schemas";
import type { ListInvoicesQuery } from "./schemas";

/** Baca tagihan untuk admin (selalu ber-schoolId dan ber-take). */

function statusCondition(filter: InvoiceStatusFilter, today: LocalDate): Prisma.InvoiceWhereInput {
  if (filter === "OVERDUE") return { status: { in: ["UNPAID", "PARTIAL"] }, dueDate: { lt: toDbDate(today) } };
  if (filter === "PENDING_VERIFICATION") return { pendingSubmission: { isNot: null } };
  return { status: filter };
}

function searchCondition(q: string | undefined): Prisma.InvoiceWhereInput | null {
  const term = likeSearch(q);
  if (!term) return null;
  return {
    OR: [
      { student: { user: { name: { contains: term } } } },
      { student: { nis: { startsWith: term } } },
      { invoiceNo: { startsWith: term } },
    ],
  };
}

function listWhere(scope: SchoolScope, query: ListInvoicesQuery, today: LocalDate): Prisma.InvoiceWhereInput {
  const and: Prisma.InvoiceWhereInput[] = [];
  if (query.status) and.push({ OR: query.status.map((f) => statusCondition(f, today)) });
  const search = searchCondition(query.q);
  if (search) and.push(search);
  return {
    schoolId: scope.schoolId,
    ...(query.periodYear !== undefined ? { periodYear: query.periodYear } : {}),
    ...(query.periodMonth !== undefined ? { periodMonth: query.periodMonth } : {}),
    ...(query.studentId ? { studentId: query.studentId } : {}),
    ...(query.classId ? { student: { currentClassId: query.classId } } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/** GET /school/invoices. */
export async function listInvoices(ctx: ActionContext, query: ListInvoicesQuery): Promise<{ data: InvoiceDto[]; meta: PageMeta }> {
  const scope = billingScopeOf(ctx, query.schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const { today } = schoolClock(school, ctx.now);
  const where = listWhere(scope, query, today);
  const [total, rows] = await Promise.all([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }, { invoiceNo: "asc" }],
      ...toSkipTake(query),
      select: INVOICE_SELECT,
    }),
  ]);
  return { data: rows.map((row) => toInvoiceDto(row, today)), meta: pageMeta(total, query.page, query.limit) };
}

/** Satu tagihan dalam cakupan sebagai DTO (dipakai juga setelah mutasi). */
export async function loadInvoiceDto(db: Tx, schoolId: string, id: string, today: LocalDate): Promise<InvoiceDto> {
  const row = await db.invoice.findFirst({ where: { id, schoolId }, select: INVOICE_SELECT });
  if (!row) throw invoiceNotFound();
  return toInvoiceDto(row, today);
}

/** GET /school/invoices/{id}: tagihan + pembayaran + riwayat bukti transfer. */
export async function getInvoiceDetail(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<InvoiceDetailDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const { today } = schoolClock(school, ctx.now);
  const row = await prisma.invoice.findFirst({
    where: { id, schoolId: scope.schoolId },
    select: {
      ...INVOICE_SELECT,
      voidedBy: { select: { id: true, name: true } },
      payments: { select: PAYMENT_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: HISTORY_LIMIT },
      submissions: { select: SUBMISSION_SUMMARY_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: HISTORY_LIMIT },
    },
  });
  if (!row) throw invoiceNotFound();
  return {
    ...toInvoiceDto(row, today),
    voidedBy: row.voidedBy,
    payments: row.payments.map(toPaymentDto),
    submissions: row.submissions.map(toSubmissionSummary),
  };
}
