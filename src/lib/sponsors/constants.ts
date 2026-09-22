/**
 * Konstanta domain sponsor (akun, saldo PPC, ledger, top-up, pengaturan platform iklan). Satu sumber
 * untuk aturan murni, skema zod, dan deskripsi OpenAPI. Uang = rupiah bulat.
 */

// ----------------------------------------------------------------------------- saldo & ledger
/** Ambang notifikasi saldo menipis (tidak ada kolomnya di PlatformSetting; keputusan desain 04 #22). */
export const LOW_BALANCE_THRESHOLD = 100_000;
/** Batas absolut satu entri penyesuaian (ADJUSTMENT) oleh super admin. */
export const ADJUSTMENT_MAX_ABS = 100_000_000;
export const LEDGER_TYPES = ["TOPUP", "CLICK_CHARGE", "ADJUSTMENT"] as const;

// ----------------------------------------------------------------------------- top-up
/** Lantai minimal top-up (PlatformSetting.minTopUpAmount tidak pernah efektif di bawah ini; CHECK DB >= 10.000). */
export const TOPUP_MIN_FLOOR = 10_000;
export const TOPUP_MAX = 100_000_000;
export const TOPUP_MAX_TRANSFER_AGE_DAYS = 30;
export const MAX_PENDING_TOPUPS = 3;
/** Bukti TOPUP_PROOF maks 8 MiB (UPLOAD_POLICY) + ruang field teks multipart. */
export const TOPUP_MAX_BODY_BYTES = 8 * 1024 * 1024 + 64 * 1024;
export const TOPUP_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

// ----------------------------------------------------------------------------- teks
export const NOTE_MIN = 5;
export const NOTE_MAX = 255;
export const COMPANY_NAME_MIN = 2;
export const COMPANY_NAME_MAX = 150;
export const CONTACT_NAME_MAX = 100;
export const PHONE_MAX = 20;
export const ADDRESS_MAX = 500;
export const SENDER_NAME_MAX = 100;
export const SENDER_BANK_MAX = 50;
export const SEARCH_MAX = 100;

// ----------------------------------------------------------------------------- pengaturan platform iklan
export const CPC_MIN = 100;
export const CPC_MAX = 100_000;
export const MAX_DEEP_LINK_SCHEMES = 20;
export const SPONSOR_STATUSES = ["PENDING", "APPROVED", "SUSPENDED"] as const;
