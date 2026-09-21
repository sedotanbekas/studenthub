import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { notifyStudents } from "@/lib/notifications/notify";
import { invoiceVoidedNotification } from "@/lib/notifications/templates/billing";
import { fromDbDate } from "@/lib/time/zone";
import { invoiceNotFound } from "./locks";
import type { InvoiceMoneyState } from "./payment-rules";

/**
 * Baca/tulis status uang satu tagihan di DALAM transaksi (setelah baris Invoice dikunci). Semua tulisan
 * memakai updateMany dengan filter sekolah (+ status yang diharapkan untuk compare-and-set).
 */
export const INVOICE_STATE_SELECT = {
  id: true, schoolId: true, studentId: true, invoiceNo: true, title: true, periodYear: true, periodMonth: true,
  amount: true, paidAmount: true, status: true, dueDate: true, paidAt: true, note: true,
  pendingSubmission: { select: { id: true } },
} as const;

export interface InvoiceState extends InvoiceMoneyState {
  readonly id: string;
  readonly schoolId: string;
  readonly studentId: string;
  readonly invoiceNo: string;
  readonly title: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly dueDate: string;
  readonly note: string | null;
  readonly pendingSubmissionId: string | null;
}

export async function readInvoiceState(db: Tx, schoolId: string, id: string): Promise<InvoiceState> {
  const row = await db.invoice.findFirst({ where: { id, schoolId }, select: INVOICE_STATE_SELECT });
  if (!row) throw invoiceNotFound();
  const { pendingSubmission, dueDate, ...rest } = row;
  return { ...rest, dueDate: fromDbDate(dueDate), pendingSubmissionId: pendingSubmission?.id ?? null };
}

/** Id + pemilik tagihan (studentId tidak pernah berubah) untuk menentukan kunci sebelum transaksi. */
export async function findInvoiceOwner(db: Tx, schoolId: string, id: string, studentId?: string): Promise<{ id: string; studentId: string }> {
  const row = await db.invoice.findFirst({
    where: { id, schoolId, ...(studentId === undefined ? {} : { studentId }) },
    select: { id: true, studentId: true },
  });
  if (!row) throw invoiceNotFound();
  return row;
}

export const stateChanged = () => conflict("STATE_CONFLICT", "Data tagihan berubah bersamaan. Muat ulang lalu coba lagi.");

/** Simpan hasil applyPaymentDelta (dipanggil saat baris Invoice terkunci). */
export async function persistMoneyState(tx: Tx, invoice: InvoiceState, next: InvoiceMoneyState): Promise<void> {
  const updated = await tx.invoice.updateMany({
    where: { id: invoice.id, schoolId: invoice.schoolId, status: invoice.status, paidAmount: invoice.paidAmount },
    data: { paidAmount: next.paidAmount, status: next.status, paidAt: next.paidAt },
  });
  if (updated.count !== 1) throw stateChanged();
}

export interface VoidInvoiceWrite {
  readonly invoice: InvoiceState;
  readonly reason: string;
  /** Asal pembatalan untuk audit (mis. "admin", "student_moved"). */
  readonly source: string;
}

/** CAS UNPAID(paid 0) -> VOID + notifikasi INVOICE_VOIDED + audit invoice.void. */
export async function writeInvoiceVoid(tx: Tx, write: VoidInvoiceWrite, ctx: ActionContext): Promise<void> {
  const { invoice, reason } = write;
  const updated = await tx.invoice.updateMany({
    where: { id: invoice.id, schoolId: invoice.schoolId, status: "UNPAID", paidAmount: 0 },
    data: { status: "VOID", voidedAt: ctx.now, voidedById: ctx.principal?.userId ?? null, voidReason: reason },
  });
  if (updated.count !== 1) throw stateChanged();
  await notifyStudents(tx, [invoice.studentId], invoiceVoidedNotification({ invoiceId: invoice.id, title: invoice.title, reason }), ctx);
  await writeAudit(
    tx,
    {
      action: "invoice.void",
      entityType: "Invoice",
      entityId: invoice.id,
      schoolId: invoice.schoolId,
      before: { status: invoice.status, invoiceNo: invoice.invoiceNo },
      after: { status: "VOID", reason, source: write.source },
    },
    ctx,
  );
}
