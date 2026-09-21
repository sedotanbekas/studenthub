import { formatLocalDate, formatRupiah } from "@/lib/billing/format";
import type { NotificationEvent } from "../notify";

/**
 * Teks notifikasi SPP (murni, Bahasa Indonesia). Tautan: { screen: "invoice", id } untuk siswa,
 * { screen: "invoices", id: "YYYY-MM" } untuk tagihan massal, { screen: "payment-review", id } untuk admin.
 */
const INVOICE_SCREEN = "invoice";

export interface InvoiceIssuedInfo {
  readonly invoiceId: string;
  readonly title: string;
  readonly amount: number;
  readonly dueDate: string;
}

export function invoiceIssuedNotification(info: InvoiceIssuedInfo): NotificationEvent {
  return {
    type: "INVOICE_ISSUED",
    title: `Tagihan baru: ${info.title}`,
    body: `Tagihan ${info.title} sebesar ${formatRupiah(info.amount)} telah terbit. Jatuh tempo ${formatLocalDate(info.dueDate)}.`,
    link: { screen: INVOICE_SCREEN, id: info.invoiceId },
  };
}

export interface BulkInvoiceIssuedInfo {
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly title: string;
  readonly amount: number;
  readonly dueDate: string;
}

/** Satu event untuk sekelompok siswa bernominal sama (fan-out createMany); tautan ke daftar periode. */
export function bulkInvoiceIssuedNotification(info: BulkInvoiceIssuedInfo): NotificationEvent {
  const period = `${info.periodYear}-${String(info.periodMonth).padStart(2, "0")}`;
  return {
    type: "INVOICE_ISSUED",
    title: `Tagihan baru: ${info.title}`,
    body: `Tagihan ${info.title} sebesar ${formatRupiah(info.amount)} telah terbit. Jatuh tempo ${formatLocalDate(info.dueDate)}.`,
    link: { screen: "invoices", id: period },
  };
}

export interface InvoiceVoidedInfo {
  readonly invoiceId: string;
  readonly title: string;
  readonly reason: string;
}

export function invoiceVoidedNotification(info: InvoiceVoidedInfo): NotificationEvent {
  return {
    type: "INVOICE_VOIDED",
    title: "Tagihan dibatalkan",
    body: `Tagihan ${info.title} dibatalkan oleh sekolah. Alasan: ${info.reason}`,
    link: { screen: INVOICE_SCREEN, id: info.invoiceId },
  };
}

export interface PaymentSubmittedInfo {
  readonly submissionId: string;
  readonly studentName: string;
  readonly className: string | null;
  readonly invoiceTitle: string;
  readonly amount: number;
}

export function paymentSubmittedNotification(info: PaymentSubmittedInfo): NotificationEvent {
  const who = info.className ? `${info.studentName} (${info.className})` : info.studentName;
  return {
    type: "PAYMENT_SUBMITTED",
    title: "Bukti transfer SPP baru",
    body: `${who} mengunggah bukti transfer ${formatRupiah(info.amount)} untuk ${info.invoiceTitle}. Menunggu verifikasi.`,
    link: { screen: "payment-review", id: info.submissionId },
  };
}

export interface PaymentApprovedInfo {
  readonly invoiceId: string;
  readonly title: string;
  readonly amount: number;
  readonly receiptNo: string;
  readonly method: "TRANSFER" | "CASH";
  /** Sisa tagihan setelah pembayaran ini. */
  readonly remaining: number;
  readonly note: string | null;
}

export function paymentApprovedNotification(info: PaymentApprovedInfo): NotificationEvent {
  const cash = info.method === "CASH";
  const main = cash
    ? `Pembayaran tunai ${formatRupiah(info.amount)} untuk ${info.title} telah dicatat (kuitansi ${info.receiptNo}).`
    : `Pembayaran ${formatRupiah(info.amount)} untuk ${info.title} telah diverifikasi (kuitansi ${info.receiptNo}).`;
  const rest = info.remaining === 0 ? "Tagihan lunas." : `Sisa tagihan ${formatRupiah(info.remaining)}.`;
  return {
    type: "PAYMENT_APPROVED",
    title: cash ? "Pembayaran tunai diterima" : "Pembayaran diterima",
    body: `${main} ${rest}${info.note ? ` Catatan: ${info.note}` : ""}`,
    link: { screen: INVOICE_SCREEN, id: info.invoiceId },
  };
}

export interface PaymentRejectedInfo {
  readonly invoiceId: string;
  readonly title: string;
  readonly amount: number;
  readonly reason: string;
}

export function paymentRejectedNotification(info: PaymentRejectedInfo): NotificationEvent {
  return {
    type: "PAYMENT_REJECTED",
    title: "Bukti transfer ditolak",
    body: `Bukti transfer ${formatRupiah(info.amount)} untuk ${info.title} ditolak. Alasan: ${info.reason}`,
    link: { screen: INVOICE_SCREEN, id: info.invoiceId },
  };
}

export interface PaymentVoidedInfo {
  readonly invoiceId: string;
  readonly title: string;
  readonly amount: number;
  readonly receiptNo: string;
  readonly reason: string;
}

export function paymentVoidedNotification(info: PaymentVoidedInfo): NotificationEvent {
  return {
    type: "PAYMENT_VOIDED",
    title: "Pembayaran dibatalkan",
    body: `Pembayaran ${formatRupiah(info.amount)} (kuitansi ${info.receiptNo}) untuk ${info.title} dibatalkan. Alasan: ${info.reason}`,
    link: { screen: INVOICE_SCREEN, id: info.invoiceId },
  };
}
