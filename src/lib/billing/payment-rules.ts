import { addDays, type LocalDate } from "@/lib/time/zone";
import { ALLOW_PARTIAL_PAYMENT, MAX_CASH_BACKDATE_DAYS, MIN_PAYMENT_AMOUNT, type InvoiceStatusValue } from "./constants";
import { InvariantError, violation, type BillingViolation } from "./errors";
import { formatRupiah } from "./format";
import { deriveInvoiceStatus } from "./invoice-status";

/** Aturan uang pembayaran (murni, tanpa mutasi). */
export interface InvoiceMoneyState {
  readonly amount: number;
  readonly paidAmount: number;
  readonly status: InvoiceStatusValue;
  readonly paidAt: Date | null;
}

/**
 * Terapkan pembayaran (+) atau pembatalan pembayaran (−). Mengembalikan objek BARU; status diturunkan
 * ulang dari nominal. paidAt: dipertahankan bila sebelumnya sudah PAID, `now` bila baru lunas, null bila tidak.
 */
export function applyPaymentDelta(state: Readonly<InvoiceMoneyState>, delta: number, now: Date): InvoiceMoneyState {
  if (state.status === "VOID") throw new InvariantError("Tagihan VOID tidak dapat menerima pembayaran");
  if (!Number.isSafeInteger(delta)) throw new InvariantError("Delta pembayaran harus bilangan bulat");
  const paidAmount = state.paidAmount + delta;
  const status = deriveInvoiceStatus(state.amount, paidAmount);
  const paidAt = status === "PAID" ? (state.status === "PAID" ? state.paidAt : now) : null;
  return { amount: state.amount, paidAmount, status, paidAt };
}

/** Nominal bayar: <= sisa, >= min(sisa, MIN_PAYMENT_AMOUNT); tanpa cicilan wajib = sisa. */
export function paymentAmountViolation(amount: number, remaining: number, allowPartial: boolean = ALLOW_PARTIAL_PAYMENT): BillingViolation | null {
  if (amount > remaining) {
    return violation("AMOUNT_EXCEEDS_REMAINING", `Nominal melebihi sisa tagihan (${formatRupiah(remaining)}).`, { remaining });
  }
  const minimum = Math.min(remaining, MIN_PAYMENT_AMOUNT);
  if (amount < minimum) {
    return violation("AMOUNT_TOO_SMALL", `Nominal minimal ${formatRupiah(minimum)}.`, { minimum, remaining });
  }
  if (!allowPartial && amount !== remaining) {
    return violation("PARTIAL_NOT_ALLOWED", `Pembayaran harus sebesar sisa tagihan (${formatRupiah(remaining)}).`, { remaining });
  }
  return null;
}

/** Tagihan menerima pembayaran baru: bukan VOID/PAID dan tidak ada bukti transfer yang menunggu. */
export function payableViolation(invoice: { readonly status: InvoiceStatusValue; readonly hasPending: boolean }): BillingViolation | null {
  if (invoice.status === "VOID" || invoice.status === "PAID") {
    return violation("INVOICE_NOT_PAYABLE", invoice.status === "PAID" ? "Tagihan sudah lunas." : "Tagihan sudah dibatalkan.", { status: invoice.status });
  }
  if (invoice.hasPending) return violation("SUBMISSION_PENDING", "Masih ada bukti transfer yang menunggu verifikasi untuk tagihan ini.");
  return null;
}

/** Tanggal terima tunai: [hari ini - 31, hari ini]. */
export function cashDateViolation(paidDate: LocalDate, today: LocalDate): BillingViolation | null {
  const earliest = addDays(today, -MAX_CASH_BACKDATE_DAYS);
  if (paidDate >= earliest && paidDate <= today) return null;
  return violation("PAID_DATE_OUT_OF_RANGE", `Tanggal pembayaran harus antara ${earliest} dan hari ini.`, { from: earliest, to: today });
}

export interface ApprovalAmountInput {
  readonly submitted: number;
  readonly remaining: number;
  readonly requested?: number;
  readonly note?: string | null;
}

export type ApprovalAmount = { readonly ok: true; readonly amount: number } | { readonly ok: false; readonly violation: BillingViolation };

const reject = (v: BillingViolation): ApprovalAmount => ({ ok: false, violation: v });

/**
 * Nominal yang disetujui: default = diajukan; wajib 1..min(diajukan, sisa). Sisa < diajukan tanpa nominal
 * eksplisit -> admin wajib memilih nominal. Disetujui < diajukan wajib catatan (dikirim ke siswa).
 */
export function resolveApprovedAmount(input: ApprovalAmountInput): ApprovalAmount {
  const { submitted, remaining } = input;
  if (input.requested === undefined && remaining < submitted) {
    return reject(violation("AMOUNT_EXCEEDS_REMAINING", `Sisa tagihan (${formatRupiah(remaining)}) lebih kecil dari nominal bukti. Tentukan nominal yang disetujui.`, { remaining }));
  }
  const amount = input.requested ?? submitted;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > submitted) {
    return reject(violation("APPROVED_AMOUNT_INVALID", `Nominal disetujui harus 1 s.d. ${formatRupiah(submitted)} (nominal bukti).`, { submitted }));
  }
  if (amount > remaining) {
    return reject(violation("AMOUNT_EXCEEDS_REMAINING", `Nominal disetujui melebihi sisa tagihan (${formatRupiah(remaining)}).`, { remaining }));
  }
  if (amount < submitted && !input.note?.trim()) {
    return reject(violation("NOTE_REQUIRED", "Catatan wajib diisi bila nominal disetujui lebih kecil dari nominal bukti."));
  }
  return { ok: true, amount };
}
