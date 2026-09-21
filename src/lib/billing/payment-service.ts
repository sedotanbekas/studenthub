import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { notifyStudents } from "@/lib/notifications/notify";
import { paymentApprovedNotification, paymentVoidedNotification } from "@/lib/notifications/templates/billing";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { billingScopeOf, loadBillingSchool, schoolClock, type SchoolClock } from "./context";
import { allocateDocumentNumbers } from "./counter";
import { PAYMENT_SELECT, toPaymentDto } from "./dto";
import { assertBilling, violation } from "./errors";
import { loadInvoiceDto } from "./invoice-queries";
import { findInvoiceOwner, persistMoneyState, readInvoiceState, stateChanged, type InvoiceState } from "./invoice-state";
import { remainingOf } from "./invoice-status";
import { lockPayment, lockStudentAndInvoice, paymentNotFound } from "./locks";
import { applyPaymentDelta, cashDateViolation, payableViolation, paymentAmountViolation } from "./payment-rules";
import type { PaymentResultDto } from "./response-schemas";
import type { CashPaymentInput, ReasonInput } from "./schemas";

/**
 * Pembayaran tunai & pembatalan pembayaran oleh admin. Urutan kunci: Student (bersama) -> Invoice ->
 * Payment -> DocumentCounter (RECEIPT); Notification & AuditLog terakhir. Nomor kuitansi tanpa celah.
 */
export interface NewPayment {
  readonly invoice: InvoiceState;
  readonly amount: number;
  readonly method: "TRANSFER" | "CASH";
  readonly paidDate: string;
  readonly note: string | null;
  readonly submissionId: string | null;
  readonly year: number;
}

/**
 * Buat Payment + nomor kuitansi + terapkan ke tagihan (baris Invoice sudah dikunci pemanggil).
 * Dipakai tunai dan persetujuan bukti transfer.
 */
export async function recordPayment(tx: Tx, payment: NewPayment, ctx: ActionContext): Promise<{ id: string; receiptNo: string; remaining: number }> {
  const { invoice } = payment;
  const next = applyPaymentDelta(invoice, payment.amount, ctx.now);
  const counter = { schoolId: invoice.schoolId, kind: "RECEIPT" as const, year: payment.year };
  const [receiptNo = ""] = (await allocateDocumentNumbers(tx, counter, 1, ctx.now)).numbers;
  const created = await tx.payment.create({
    data: {
      schoolId: invoice.schoolId, invoiceId: invoice.id, receiptNo, amount: payment.amount, method: payment.method,
      paidDate: toDbDate(payment.paidDate), submissionId: payment.submissionId, recordedById: requirePrincipal(ctx).userId,
      note: payment.note, createdAt: ctx.now,
    },
    select: { id: true },
  });
  await persistMoneyState(tx, invoice, next);
  return { id: created.id, receiptNo, remaining: next.amount - next.paidAmount };
}

export async function loadPaymentResult(schoolId: string, paymentId: string, invoiceId: string, today: string): Promise<PaymentResultDto> {
  const row = await prisma.payment.findFirst({ where: { id: paymentId, schoolId }, select: PAYMENT_SELECT });
  if (!row) throw paymentNotFound();
  return { payment: toPaymentDto(row), invoice: await loadInvoiceDto(prisma, schoolId, invoiceId, today) };
}

/**
 * Token konkurensi tunai: paidAmount yang dilihat admin harus sama dengan paidAmount terkini (di bawah
 * kunci). Permintaan yang diulang (respons hilang, klik ganda) membawa token lama -> 409, bukan cicilan kedua.
 */
const paidAmountChanged = (paidAmount: number) =>
  conflict("STATE_CONFLICT", "Nominal terbayar tagihan sudah berubah (ada pembayaran lain tercatat). Muat ulang tagihan lalu periksa sebelum mencatat lagi.", { paidAmount });

async function cashInTx(tx: Tx, owner: { id: string; studentId: string }, schoolId: string, input: CashPaymentInput, clock: SchoolClock, ctx: ActionContext) {
  await lockStudentAndInvoice(tx, { id: owner.id, schoolId, studentId: owner.studentId });
  const invoice = await readInvoiceState(tx, schoolId, owner.id);
  if (invoice.paidAmount !== input.expectedPaidAmount) throw paidAmountChanged(invoice.paidAmount);
  assertBilling(payableViolation({ status: invoice.status, hasPending: invoice.pendingSubmissionId !== null }));
  assertBilling(cashDateViolation(input.paidDate, clock.today));
  assertBilling(paymentAmountViolation(input.amount, remainingOf(invoice)));
  const note = input.note ?? null;
  const payment = await recordPayment(tx, { invoice, amount: input.amount, method: "CASH", paidDate: input.paidDate, note, submissionId: null, year: clock.year }, ctx);
  const event = paymentApprovedNotification({
    invoiceId: invoice.id, title: invoice.title, amount: input.amount, receiptNo: payment.receiptNo, method: "CASH", remaining: payment.remaining, note,
  });
  await notifyStudents(tx, [invoice.studentId], event, ctx);
  const after = { invoiceId: invoice.id, receiptNo: payment.receiptNo, amount: input.amount, paidDate: input.paidDate, remaining: payment.remaining };
  await writeAudit(tx, { action: "payment.cash_record", entityType: "Payment", entityId: payment.id, schoolId, after }, ctx);
  return payment.id;
}

/** POST /school/invoices/{id}/payments: catat pembayaran tunai. */
export async function recordCashPayment(ctx: ActionContext, schoolId: string | undefined, invoiceId: string, input: CashPaymentInput): Promise<PaymentResultDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const clock = schoolClock(school, ctx.now);
  const owner = await findInvoiceOwner(prisma, scope.schoolId, invoiceId);
  const paymentId = await withTx((tx) => cashInTx(tx, owner, scope.schoolId, input, clock, ctx));
  return loadPaymentResult(scope.schoolId, paymentId, invoiceId, clock.today);
}

const alreadyVoided = () => violation("PAYMENT_ALREADY_VOIDED", "Pembayaran ini sudah dibatalkan.");

async function voidInTx(tx: Tx, target: { id: string; invoiceId: string; studentId: string }, schoolId: string, reason: string, ctx: ActionContext) {
  await lockStudentAndInvoice(tx, { id: target.invoiceId, schoolId, studentId: target.studentId });
  await lockPayment(tx, schoolId, target.id);
  const payment = await tx.payment.findFirst({ where: { id: target.id, schoolId }, select: { amount: true, receiptNo: true, voidedAt: true } });
  if (!payment) throw paymentNotFound();
  if (payment.voidedAt) assertBilling(alreadyVoided());
  const invoice = await readInvoiceState(tx, schoolId, target.invoiceId);
  const next = applyPaymentDelta(invoice, -payment.amount, ctx.now);
  const updated = await tx.payment.updateMany({
    where: { id: target.id, schoolId, voidedAt: null },
    data: { voidedAt: ctx.now, voidedById: requirePrincipal(ctx).userId, voidReason: reason },
  });
  if (updated.count !== 1) throw stateChanged();
  await persistMoneyState(tx, invoice, next);
  const event = paymentVoidedNotification({ invoiceId: invoice.id, title: invoice.title, amount: payment.amount, receiptNo: payment.receiptNo, reason });
  await notifyStudents(tx, [invoice.studentId], event, ctx);
  const audit = {
    action: "payment.void", entityType: "Payment", entityId: target.id, schoolId,
    before: { voided: false, invoiceStatus: invoice.status, paidAmount: invoice.paidAmount },
    after: { voided: true, reason, invoiceStatus: next.status, paidAmount: next.paidAmount },
  };
  await writeAudit(tx, audit, ctx);
}

/** POST /school/payments/{id}/void: kuitansi tetap bernomor (ditandai dibatalkan), tagihan dihitung ulang. */
export async function voidPayment(ctx: ActionContext, schoolId: string | undefined, id: string, input: ReasonInput): Promise<PaymentResultDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const row = await prisma.payment.findFirst({ where: { id, schoolId: scope.schoolId }, select: { id: true, invoiceId: true } });
  if (!row) throw paymentNotFound();
  const owner = await findInvoiceOwner(prisma, scope.schoolId, row.invoiceId);
  await withTx((tx) => voidInTx(tx, { id, invoiceId: row.invoiceId, studentId: owner.studentId }, scope.schoolId, input.reason, ctx));
  return loadPaymentResult(scope.schoolId, id, row.invoiceId, schoolClock(school, ctx.now).today);
}
