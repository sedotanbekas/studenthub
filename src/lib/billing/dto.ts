import type { Prisma } from "@prisma/client";
import { fromDbDate, type LocalDate } from "@/lib/time/zone";
import { invoiceDisplayStatus, isOverdue, remainingOf } from "./invoice-status";
import type {
  InvoiceDto,
  PaymentDto,
  StudentInvoiceDto,
  SubmissionSummaryDto,
} from "./response-schemas";

/** Select Prisma + pemetaan baris -> DTO SPP (murni setelah data dibaca). */

const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

export const STUDENT_REF_SELECT = {
  id: true,
  nis: true,
  user: { select: { name: true } },
  currentClass: { select: { name: true } },
} as const satisfies Prisma.StudentSelect;

type StudentRefRow = Prisma.StudentGetPayload<{ select: typeof STUDENT_REF_SELECT }>;

export const toStudentRef = (row: StudentRefRow) => ({ id: row.id, name: row.user.name, nis: row.nis, className: row.currentClass?.name ?? null });

export const INVOICE_SELECT = {
  id: true, invoiceNo: true, studentId: true, title: true, periodYear: true, periodMonth: true, amount: true, paidAmount: true,
  status: true, dueDate: true, paidAt: true, note: true, voidedAt: true, voidReason: true, createdAt: true,
  student: { select: STUDENT_REF_SELECT },
  pendingSubmission: { select: { id: true, amount: true, createdAt: true } },
} as const satisfies Prisma.InvoiceSelect;

export type InvoiceRow = Prisma.InvoiceGetPayload<{ select: typeof INVOICE_SELECT }>;

type CoreRow = Pick<InvoiceRow, "id" | "invoiceNo" | "title" | "periodYear" | "periodMonth" | "amount" | "paidAmount" | "status" | "dueDate"> & {
  readonly pendingSubmission: { readonly id: string } | null;
};

function invoiceCore(row: CoreRow, today: LocalDate) {
  const dueDate = fromDbDate(row.dueDate);
  const state = { status: row.status, dueDate, hasPendingSubmission: row.pendingSubmission !== null };
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    title: row.title,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    amount: row.amount,
    paidAmount: row.paidAmount,
    remaining: remainingOf(row),
    dueDate,
    status: row.status,
    displayStatus: invoiceDisplayStatus(state, today),
    isOverdue: isOverdue(state, today),
  };
}

export function toInvoiceDto(row: InvoiceRow, today: LocalDate): InvoiceDto {
  return {
    ...invoiceCore(row, today),
    student: toStudentRef(row.student),
    pendingSubmissionId: row.pendingSubmission?.id ?? null,
    paidAt: iso(row.paidAt),
    note: row.note,
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toStudentInvoiceDto(row: InvoiceRow, today: LocalDate): StudentInvoiceDto {
  const pending = row.pendingSubmission;
  return {
    ...invoiceCore(row, today),
    pendingSubmission: pending ? { id: pending.id, amount: pending.amount, createdAt: pending.createdAt.toISOString() } : null,
  };
}

export const PAYMENT_SELECT = {
  id: true, invoiceId: true, receiptNo: true, amount: true, method: true, paidDate: true, note: true, submissionId: true,
  voidedAt: true, voidReason: true, createdAt: true,
  recordedBy: { select: { id: true, name: true } },
} as const satisfies Prisma.PaymentSelect;

export type PaymentRow = Prisma.PaymentGetPayload<{ select: typeof PAYMENT_SELECT }>;

export function toPaymentDto(row: PaymentRow): PaymentDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    receiptNo: row.receiptNo,
    amount: row.amount,
    method: row.method,
    paidDate: fromDbDate(row.paidDate),
    note: row.note,
    submissionId: row.submissionId,
    recordedBy: row.recordedBy,
    voided: row.voidedAt !== null,
    voidedAt: iso(row.voidedAt),
    voidReason: row.voidReason,
    createdAt: row.createdAt.toISOString(),
  };
}

export const SUBMISSION_SUMMARY_SELECT = {
  id: true, invoiceId: true, status: true, amount: true, transferDate: true, senderName: true, senderBank: true, note: true,
  reviewNote: true, reviewedAt: true, createdAt: true, proofFileId: true,
} as const satisfies Prisma.PaymentSubmissionSelect;

export type SubmissionSummaryRow = Prisma.PaymentSubmissionGetPayload<{ select: typeof SUBMISSION_SUMMARY_SELECT }>;

export function toSubmissionSummary(row: SubmissionSummaryRow): SubmissionSummaryDto {
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    status: row.status,
    amount: row.amount,
    transferDate: fromDbDate(row.transferDate),
    senderName: row.senderName,
    senderBank: row.senderBank,
    note: row.note,
    reviewNote: row.reviewNote,
    reviewedAt: iso(row.reviewedAt),
    createdAt: row.createdAt.toISOString(),
    proofFileId: row.proofFileId,
  };
}
