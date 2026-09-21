import { AppError } from "@/lib/http/errors";

/**
 * Kode pelanggaran aturan SPP beserta status HTTP-nya. Aturan murni mengembalikan `BillingViolation`;
 * service mengubahnya menjadi AppError lewat `assertBilling`. Semua kode baru juga harus terdaftar di
 * src/lib/http/error-status.ts (dikerjakan tahap integrasi).
 */
export const BILLING_ERROR_STATUS = {
  PERIOD_OUT_OF_RANGE: 422,
  DUE_DATE_OUT_OF_RANGE: 422,
  STUDENT_NOT_BILLABLE: 422,
  INVOICE_EXISTS: 409,
  INVOICE_VOID: 409,
  INVOICE_NOT_VOID: 409,
  INVOICE_ALREADY_PAID: 409,
  INVOICE_HAS_PAYMENTS: 409,
  INVOICE_NOT_PAYABLE: 409,
  SUBMISSION_PENDING: 409,
  SUBMISSION_NOT_PENDING: 409,
  SUBMISSION_ALREADY_REVIEWED: 409,
  PAYMENT_ALREADY_VOIDED: 409,
  TOO_MANY_SUBMISSIONS: 429,
  AMOUNT_EXCEEDS_REMAINING: 422,
  AMOUNT_TOO_SMALL: 422,
  PARTIAL_NOT_ALLOWED: 422,
  APPROVED_AMOUNT_INVALID: 422,
  NOTE_REQUIRED: 422,
  TRANSFER_DATE_OUT_OF_RANGE: 422,
  PAID_DATE_OUT_OF_RANGE: 422,
  BULK_TOO_LARGE: 422,
  BULK_OVERRIDE_OUT_OF_SCOPE: 422,
} as const satisfies Record<string, 409 | 422 | 429>;

export type BillingErrorCode = keyof typeof BILLING_ERROR_STATUS;

export interface BillingViolation {
  readonly code: BillingErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const violation = (code: BillingErrorCode, message: string, details?: Readonly<Record<string, unknown>>): BillingViolation =>
  details === undefined ? { code, message } : { code, message, details };

export function billingError(v: BillingViolation, headers?: Record<string, string>): AppError {
  return new AppError(BILLING_ERROR_STATUS[v.code], v.code, v.message, v.details, headers);
}

/** Lempar AppError dengan status sesuai kode bila ada pelanggaran. */
export function assertBilling(v: BillingViolation | null): void {
  if (v) throw billingError(v);
}

/** Selalu melempar (tipe `never` untuk penyempitan tipe di pemanggil). */
export function failBilling(v: BillingViolation, headers?: Record<string, string>): never {
  throw billingError(v, headers);
}

/** Pelanggaran invarian uang (bug pemanggil, bukan input pengguna) -> 500. */
export class InvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvariantError";
  }
}
