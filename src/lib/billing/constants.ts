/**
 * Konstanta domain SPP (tagihan, bukti transfer, pembayaran, nomor dokumen). Satu sumber untuk aturan murni,
 * skema zod, dan deskripsi OpenAPI.
 */

// ----------------------------------------------------------------------------- nominal (rupiah bulat)
export const MIN_INVOICE_AMOUNT = 1_000;
export const MAX_INVOICE_AMOUNT = 50_000_000;
/** Nominal pembayaran minimum = min(sisa, nilai ini) — sisa kecil tetap bisa dilunasi. */
export const MIN_PAYMENT_AMOUNT = 10_000;
/** Keputusan klien: cicilan/sebagian boleh. */
export const ALLOW_PARTIAL_PAYMENT = true;

// ----------------------------------------------------------------------------- periode & jatuh tempo
export const MAX_PAST_PERIOD_MONTHS = 24;
export const MAX_FUTURE_PERIOD_MONTHS = 12;
export const DEFAULT_DUE_DAY = 10;
export const DUE_DATE_MIN_OFFSET_MONTHS = -1;
export const DUE_DATE_MAX_OFFSET_MONTHS = 3;
export const MIN_PERIOD_YEAR = 2000;
export const MAX_PERIOD_YEAR = 2100;

// ----------------------------------------------------------------------------- bukti & pembayaran
export const MAX_TRANSFER_AGE_DAYS = 90;
export const MAX_CASH_BACKDATE_DAYS = 31;
export const MAX_SUBMISSIONS_PER_INVOICE_PER_DAY = 5;
/** Bukti PAYMENT_PROOF maks 8 MiB (UPLOAD_POLICY) + ruang untuk field teks multipart. */
export const PROOF_MAX_BODY_BYTES = 8 * 1024 * 1024 + 64 * 1024;
/** Jendela kandidat penanda bukti mirip (dHash) dalam sekolah yang sama. */
export const DUPLICATE_LOOKBACK_DAYS = 365;
export const DUPLICATE_CANDIDATE_LIMIT = 5_000;

// ----------------------------------------------------------------------------- massal
export const BULK_CHUNK_SIZE = 200;
export const MAX_BULK_INVOICE_STUDENTS = 3_000;
export const MAX_BULK_SKIPPED_LISTED = 500;
export const MAX_BULK_CLASSES = 100;
/** Transaksi per chunk massal (200 siswa) diberi waktu lebih longgar dari default 20 s. */
export const BULK_TX_TIMEOUT_MS = 60_000;

// ----------------------------------------------------------------------------- teks
export const TITLE_MAX = 100;
export const NOTE_MAX = 255;
export const REASON_MIN = 5;
export const REASON_MAX = 255;
export const SENDER_NAME_MIN = 2;
export const SENDER_NAME_MAX = 100;
export const SENDER_BANK_MIN = 2;
export const SENDER_BANK_MAX = 50;
export const SEARCH_QUERY_MAX = 100;
/** Riwayat pengajuan per tagihan yang ditampilkan di detail. */
export const HISTORY_LIMIT = 50;

// ----------------------------------------------------------------------------- rekening sekolah
/** /student/payment-info menandai rekening "baru berubah" selama sekian hari sejak bankChangedAt. */
export const BANK_CHANGE_NOTICE_DAYS = 14;

// ----------------------------------------------------------------------------- enum turunan
export const INVOICE_STATUSES = ["UNPAID", "PARTIAL", "PAID", "VOID"] as const;
export type InvoiceStatusValue = (typeof INVOICE_STATUSES)[number];
export type MoneyStatus = Exclude<InvoiceStatusValue, "VOID">;

/** Status tampilan (label di ENUM_LABELS.InvoiceDisplayStatus). */
export const DISPLAY_STATUSES = ["BELUM_BAYAR", "SEBAGIAN", "MENUNGGU_VERIFIKASI", "JATUH_TEMPO", "LUNAS", "DIBATALKAN"] as const;
export type DisplayStatus = (typeof DISPLAY_STATUSES)[number];

/** Filter daftar admin: status tersimpan + status turunan OVERDUE & PENDING_VERIFICATION. */
export const INVOICE_STATUS_FILTERS = [...INVOICE_STATUSES, "OVERDUE", "PENDING_VERIFICATION"] as const;
export type InvoiceStatusFilter = (typeof INVOICE_STATUS_FILTERS)[number];

export const STUDENT_INVOICE_FILTERS = ["OUTSTANDING", "PAID", "ALL"] as const;
export type StudentInvoiceFilter = (typeof STUDENT_INVOICE_FILTERS)[number];

export const SUBMISSION_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export const SUBMISSION_STATUS_FILTERS = [...SUBMISSION_STATUSES, "ALL"] as const;
export type SubmissionStatusFilter = (typeof SUBMISSION_STATUS_FILTERS)[number];

export const PAYMENT_METHODS = ["TRANSFER", "CASH"] as const;

export const BULK_SKIP_REASONS = ["ALREADY_BILLED", "EXEMPT", "NOT_ACTIVE", "AMOUNT_INVALID"] as const;
export type BulkSkipReason = (typeof BULK_SKIP_REASONS)[number];

export const MONTH_NAMES = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;
