import { AppError } from "@/lib/http/errors";

/**
 * Kode pelanggaran aturan sponsor/ledger/top-up beserta status HTTP-nya. Aturan murni mengembalikan
 * `SponsorViolation`; service mengubahnya menjadi AppError lewat `failSponsor`. Semua kode juga terdaftar
 * di src/lib/http/error-status.ts (dicek errors.test.ts).
 */
export const SPONSOR_ERROR_STATUS = {
  SPONSOR_INVALID_TRANSITION: 409,
  TOPUP_ALREADY_REVIEWED: 409,
  TOPUP_LIMIT: 409,
  TOPUP_AMOUNT_INVALID: 422,
  TRANSFER_DATE_OUT_OF_RANGE: 422,
  LEDGER_AMOUNT_INVALID: 422,
  INSUFFICIENT_BALANCE: 422,
  SETTINGS_INVALID: 422,
} as const satisfies Record<string, 409 | 422>;

export type SponsorErrorCode = keyof typeof SPONSOR_ERROR_STATUS;

export interface SponsorViolation {
  readonly code: SponsorErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const sponsorViolation = (code: SponsorErrorCode, message: string, details?: Readonly<Record<string, unknown>>): SponsorViolation =>
  details === undefined ? { code, message } : { code, message, details };

export function sponsorError(v: SponsorViolation): AppError {
  return new AppError(SPONSOR_ERROR_STATUS[v.code], v.code, v.message, v.details);
}

/** Selalu melempar (tipe `never` untuk penyempitan tipe di pemanggil). */
export function failSponsor(v: SponsorViolation): never {
  throw sponsorError(v);
}

export function assertSponsorRule(v: SponsorViolation | null): void {
  if (v) failSponsor(v);
}
