import { AppError } from "@/lib/http/errors";

/**
 * Kode pelanggaran aturan iklan beserta status HTTP-nya. Aturan murni mengembalikan `AdViolation`; service
 * mengubahnya menjadi AppError lewat `failAd`. Semua kode juga terdaftar di src/lib/http/error-status.ts
 * (dicek errors.test.ts).
 */
export const AD_ERROR_STATUS = {
  ANALYTICS_RANGE_INVALID: 400,
  AD_TOKEN_INVALID: 403,
  AD_INVALID_TRANSITION: 409,
  AD_EDIT_WHILE_PENDING: 409,
  AD_REVIEW_STALE: 409,
  AD_NOT_DELETABLE: 409,
  AD_SCHEDULE_INVALID: 422,
  AD_TARGETS_INVALID: 422,
  AD_LINK_INVALID: 422,
  AD_LIMIT_REACHED: 422,
} as const satisfies Record<string, 400 | 403 | 409 | 422>;

export type AdErrorCode = keyof typeof AD_ERROR_STATUS;

export interface AdViolation {
  readonly code: AdErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const adViolation = (code: AdErrorCode, message: string, details?: Readonly<Record<string, unknown>>): AdViolation =>
  details === undefined ? { code, message } : { code, message, details };

export function adError(v: AdViolation): AppError {
  return new AppError(AD_ERROR_STATUS[v.code], v.code, v.message, v.details);
}

/** Selalu melempar (tipe `never` untuk penyempitan tipe di pemanggil). */
export function failAd(v: AdViolation): never {
  throw adError(v);
}

export function assertAdRule(v: AdViolation | null): void {
  if (v) failAd(v);
}
