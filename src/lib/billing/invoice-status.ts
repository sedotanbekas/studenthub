import type { LocalDate } from "@/lib/time/zone";
import type { DisplayStatus, InvoiceStatusValue, MoneyStatus } from "./constants";
import { InvariantError } from "./errors";

/**
 * Status tersimpan (uang saja) dan status tampilan turunan (murni). "Menunggu verifikasi" & "Jatuh tempo"
 * tidak pernah disimpan agar tidak ada penulis status kedua yang bisa menyimpang dari paidAmount.
 */
export function deriveInvoiceStatus(amount: number, paid: number): MoneyStatus {
  if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(paid)) throw new InvariantError("Nominal tagihan harus bilangan bulat");
  if (amount <= 0) throw new InvariantError("Nominal tagihan harus > 0");
  if (paid < 0 || paid > amount) throw new InvariantError(`Jumlah terbayar ${paid} di luar 0..${amount}`);
  if (paid === 0) return "UNPAID";
  return paid === amount ? "PAID" : "PARTIAL";
}

export interface InvoiceMoney {
  readonly amount: number;
  readonly paidAmount: number;
  readonly status: InvoiceStatusValue;
}

/** Sisa yang masih harus dibayar; tagihan VOID tidak punya sisa. */
export const remainingOf = (invoice: InvoiceMoney): number => (invoice.status === "VOID" ? 0 : invoice.amount - invoice.paidAmount);

export interface DueState {
  readonly status: InvoiceStatusValue;
  /** Tanggal lokal "YYYY-MM-DD". */
  readonly dueDate: LocalDate;
}

/** Terlambat bila belum lunas dan hari ini (tanggal lokal sekolah) > jatuh tempo; hari jatuh tempo belum terlambat. */
export const isOverdue = (invoice: DueState, today: LocalDate): boolean =>
  (invoice.status === "UNPAID" || invoice.status === "PARTIAL") && today > invoice.dueDate;

export interface DisplayState extends DueState {
  readonly hasPendingSubmission: boolean;
}

/** Presedensi: VOID > PAID > menunggu verifikasi > jatuh tempo > PARTIAL > belum bayar. */
export function invoiceDisplayStatus(invoice: DisplayState, today: LocalDate): DisplayStatus {
  if (invoice.status === "VOID") return "DIBATALKAN";
  if (invoice.status === "PAID") return "LUNAS";
  if (invoice.hasPendingSubmission) return "MENUNGGU_VERIFIKASI";
  if (isOverdue(invoice, today)) return "JATUH_TEMPO";
  return invoice.status === "PARTIAL" ? "SEBAGIAN" : "BELUM_BAYAR";
}
