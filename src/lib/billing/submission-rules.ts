import { addDays, type LocalDate } from "@/lib/time/zone";
import { MAX_SUBMISSIONS_PER_INVOICE_PER_DAY, MAX_TRANSFER_AGE_DAYS, type InvoiceStatusValue } from "./constants";
import { violation, type BillingViolation } from "./errors";
import { payableViolation, paymentAmountViolation } from "./payment-rules";

/** Aturan pengajuan bukti transfer oleh siswa (murni). Urutan: status tagihan (409) -> kuota (429) -> input (422). */
export interface SubmissionState {
  readonly status: InvoiceStatusValue;
  readonly amount: number;
  readonly paidAmount: number;
  readonly hasPending: boolean;
  /** Pengajuan untuk tagihan ini sejak awal hari lokal (semua status). */
  readonly submittedToday: number;
}

export interface SubmissionInput {
  readonly amount: number;
  readonly transferDate: LocalDate;
}

/** Tanggal transfer: [hari ini - 90, hari ini]. */
export function transferDateViolation(transferDate: LocalDate, today: LocalDate): BillingViolation | null {
  const earliest = addDays(today, -MAX_TRANSFER_AGE_DAYS);
  if (transferDate >= earliest && transferDate <= today) return null;
  return violation(
    "TRANSFER_DATE_OUT_OF_RANGE",
    `Tanggal transfer harus antara ${earliest} dan hari ini (maks ${MAX_TRANSFER_AGE_DAYS} hari lalu).`,
    { from: earliest, to: today },
  );
}

export function submissionViolation(state: SubmissionState, input: SubmissionInput, today: LocalDate): BillingViolation | null {
  const payable = payableViolation(state);
  if (payable) return payable;
  if (state.submittedToday >= MAX_SUBMISSIONS_PER_INVOICE_PER_DAY) {
    return violation(
      "TOO_MANY_SUBMISSIONS",
      `Bukti transfer untuk satu tagihan dibatasi ${MAX_SUBMISSIONS_PER_INVOICE_PER_DAY} kali per hari. Silakan coba lagi besok.`,
      { limit: MAX_SUBMISSIONS_PER_INVOICE_PER_DAY },
    );
  }
  return paymentAmountViolation(input.amount, state.amount - state.paidAmount) ?? transferDateViolation(input.transferDate, today);
}
