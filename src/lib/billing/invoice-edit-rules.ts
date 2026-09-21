import type { StudentStatus } from "@prisma/client";
import type { LocalDate } from "@/lib/time/zone";
import type { InvoiceStatusValue } from "./constants";
import { violation, type BillingViolation } from "./errors";

/** Aturan ubah / batalkan / pulihkan tagihan (murni). Rentang jatuh tempo dicek terpisah (validateDueDate). */
export interface EditableInvoice {
  readonly status: InvoiceStatusValue;
  readonly hasPending: boolean;
}

export interface InvoicePatch {
  readonly amount?: number;
  readonly dueDate?: LocalDate;
  readonly title?: string;
  readonly note?: string | null;
}

const invoiceVoid = () => violation("INVOICE_VOID", "Tagihan sudah dibatalkan. Pulihkan dulu untuk mengubahnya.");
const pending = () => violation("SUBMISSION_PENDING", "Masih ada bukti transfer yang menunggu verifikasi untuk tagihan ini.");
const hasPayments = () => violation("INVOICE_HAS_PAYMENTS", "Tagihan sudah memiliki pembayaran.");

export function invoiceEditViolation(invoice: EditableInvoice, patch: InvoicePatch): BillingViolation | null {
  if (invoice.status === "VOID") return invoiceVoid();
  const onlyNote = patch.amount === undefined && patch.dueDate === undefined && patch.title === undefined;
  if (invoice.status === "PAID") {
    return onlyNote ? null : violation("INVOICE_ALREADY_PAID", "Tagihan sudah lunas; hanya catatan yang dapat diubah.");
  }
  if (patch.amount !== undefined) {
    if (invoice.status !== "UNPAID") return hasPayments();
    if (invoice.hasPending) return pending();
  }
  return null;
}

export interface VoidableInvoice {
  readonly status: InvoiceStatusValue;
  readonly paidAmount: number;
  readonly hasPending: boolean;
}

/** Hanya UNPAID tanpa pembayaran dan tanpa pengajuan menunggu. */
export function voidViolation(invoice: VoidableInvoice): BillingViolation | null {
  if (invoice.status === "VOID") return violation("INVOICE_VOID", "Tagihan sudah dibatalkan.");
  if (invoice.status !== "UNPAID" || invoice.paidAmount > 0) {
    return violation("INVOICE_HAS_PAYMENTS", "Tagihan yang sudah dibayar tidak dapat dibatalkan. Batalkan pembayarannya lebih dulu.");
  }
  return invoice.hasPending ? pending() : null;
}

/** VOID -> UNPAID; siswa PINDAH tidak dapat ditagih lagi. */
export function restoreViolation(invoice: { readonly status: InvoiceStatusValue }, studentStatus: StudentStatus): BillingViolation | null {
  if (invoice.status !== "VOID") return violation("INVOICE_NOT_VOID", "Hanya tagihan yang dibatalkan yang dapat dipulihkan.");
  if (studentStatus === "MOVED") {
    return violation("STUDENT_NOT_BILLABLE", "Siswa sudah pindah sekolah; tagihannya tidak dapat dipulihkan.", { studentStatus });
  }
  return null;
}
