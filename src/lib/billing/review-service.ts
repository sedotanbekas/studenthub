import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { notifyStudents } from "@/lib/notifications/notify";
import { paymentApprovedNotification, paymentRejectedNotification } from "@/lib/notifications/templates/billing";
import { fromDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { billingScopeOf, loadBillingSchool, schoolClock, type SchoolClock } from "./context";
import { failBilling, violation } from "./errors";
import { readInvoiceState, type InvoiceState } from "./invoice-state";
import { remainingOf } from "./invoice-status";
import { lockStudentAndInvoice, lockSubmission, submissionNotFound } from "./locks";
import { loadPaymentResult, recordPayment } from "./payment-service";
import { resolveApprovedAmount } from "./payment-rules";
import type { AdminSubmissionDto, ApproveResultDto } from "./response-schemas";
import type { ApproveSubmissionInput, ReasonInput } from "./schemas";
import { loadAdminSubmission } from "./submission-queries";

/**
 * Verifikasi bukti transfer oleh admin. Urutan kunci: Student (bersama) -> Invoice -> PaymentSubmission ->
 * (Payment + DocumentCounter RECEIPT saat approve); Notification & AuditLog terakhir. Transisi PENDING ->
 * APPROVED/REJECTED = compare-and-set yang sekaligus membebaskan slot pendingInvoiceId.
 */
interface ReviewTarget {
  readonly id: string;
  readonly invoiceId: string;
  readonly studentId: string;
}

interface LockedReview {
  readonly submission: { readonly amount: number; readonly transferDate: Date };
  readonly invoice: InvoiceState;
}

const alreadyReviewed = (status: string) =>
  violation("SUBMISSION_ALREADY_REVIEWED", "Bukti transfer ini sudah ditinjau atau dibatalkan.", { status });

async function findTarget(schoolId: string, id: string): Promise<ReviewTarget> {
  const row = await prisma.paymentSubmission.findFirst({ where: { id, schoolId }, select: { id: true, invoiceId: true, studentId: true } });
  if (!row) throw submissionNotFound();
  return row;
}

async function lockReview(tx: Tx, target: ReviewTarget, schoolId: string): Promise<LockedReview> {
  await lockStudentAndInvoice(tx, { id: target.invoiceId, schoolId, studentId: target.studentId });
  await lockSubmission(tx, schoolId, target.id);
  const submission = await tx.paymentSubmission.findFirst({ where: { id: target.id, schoolId }, select: { status: true, amount: true, transferDate: true } });
  if (!submission) throw submissionNotFound();
  if (submission.status !== "PENDING") failBilling(alreadyReviewed(submission.status));
  return { submission, invoice: await readInvoiceState(tx, schoolId, target.invoiceId) };
}

interface ReviewWrite {
  readonly status: "APPROVED" | "REJECTED";
  readonly note: string | null;
}

async function markReviewed(tx: Tx, target: ReviewTarget, schoolId: string, review: ReviewWrite, ctx: ActionContext): Promise<void> {
  const updated = await tx.paymentSubmission.updateMany({
    where: { id: target.id, schoolId, status: "PENDING" },
    data: { status: review.status, pendingInvoiceId: null, reviewedById: requirePrincipal(ctx).userId, reviewedAt: ctx.now, reviewNote: review.note },
  });
  if (updated.count !== 1) failBilling(alreadyReviewed("UNKNOWN"));
}

function resolveAmount(locked: LockedReview, input: ApproveSubmissionInput): number {
  const { invoice } = locked;
  if (invoice.status === "VOID") failBilling(violation("INVOICE_NOT_PAYABLE", "Tagihan sudah dibatalkan; tolak bukti transfer ini.", { status: invoice.status }));
  const remaining = remainingOf(invoice);
  if (remaining === 0) failBilling(violation("INVOICE_ALREADY_PAID", "Tagihan sudah lunas; tolak bukti transfer ini."));
  const resolved = resolveApprovedAmount({ submitted: locked.submission.amount, remaining, requested: input.approvedAmount, note: input.note });
  return resolved.ok ? resolved.amount : failBilling(resolved.violation);
}

async function approveInTx(tx: Tx, target: ReviewTarget, schoolId: string, input: ApproveSubmissionInput, clock: SchoolClock, ctx: ActionContext) {
  const locked = await lockReview(tx, target, schoolId);
  const amount = resolveAmount(locked, input);
  const note = input.note ?? null;
  await markReviewed(tx, target, schoolId, { status: "APPROVED", note }, ctx);
  const { invoice } = locked;
  const paidDate = fromDbDate(locked.submission.transferDate);
  const payment = await recordPayment(tx, { invoice, amount, method: "TRANSFER", paidDate, note, submissionId: target.id, year: clock.year }, ctx);
  const event = paymentApprovedNotification({ invoiceId: invoice.id, title: invoice.title, amount, receiptNo: payment.receiptNo, method: "TRANSFER", remaining: payment.remaining, note });
  await notifyStudents(tx, [invoice.studentId], event, ctx);
  const after = { status: "APPROVED", submitted: locked.submission.amount, approvedAmount: amount, receiptNo: payment.receiptNo, paymentId: payment.id, note };
  await writeAudit(tx, { action: "submission.approve", entityType: "PaymentSubmission", entityId: target.id, schoolId, before: { status: "PENDING" }, after }, ctx);
  return payment.id;
}

/** POST /school/payment-submissions/{id}/approve. */
export async function approveSubmission(ctx: ActionContext, schoolId: string | undefined, id: string, input: ApproveSubmissionInput): Promise<ApproveResultDto> {
  const scope = billingScopeOf(ctx, schoolId);
  const school = await loadBillingSchool(prisma, scope.schoolId);
  const clock = schoolClock(school, ctx.now);
  const target = await findTarget(scope.schoolId, id);
  const paymentId = await withTx((tx) => approveInTx(tx, target, scope.schoolId, input, clock, ctx));
  const result = await loadPaymentResult(scope.schoolId, paymentId, target.invoiceId, clock.today);
  return { submission: await loadAdminSubmission(prisma, scope.schoolId, id), ...result };
}

/** POST /school/payment-submissions/{id}/reject: alasan wajib, dikirim ke siswa. */
export async function rejectSubmission(ctx: ActionContext, schoolId: string | undefined, id: string, input: ReasonInput): Promise<AdminSubmissionDto> {
  const scope = billingScopeOf(ctx, schoolId);
  await loadBillingSchool(prisma, scope.schoolId);
  const target = await findTarget(scope.schoolId, id);
  await withTx(async (tx) => {
    const { submission, invoice } = await lockReview(tx, target, scope.schoolId);
    await markReviewed(tx, target, scope.schoolId, { status: "REJECTED", note: input.reason }, ctx);
    const event = paymentRejectedNotification({ invoiceId: invoice.id, title: invoice.title, amount: submission.amount, reason: input.reason });
    await notifyStudents(tx, [invoice.studentId], event, ctx);
    const audit = {
      action: "submission.reject", entityType: "PaymentSubmission", entityId: id, schoolId: scope.schoolId,
      before: { status: "PENDING" }, after: { status: "REJECTED", reason: input.reason },
    };
    await writeAudit(tx, audit, ctx);
  });
  return loadAdminSubmission(prisma, scope.schoolId, id);
}
