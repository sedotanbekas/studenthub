/** Konstanta dispatcher push Expo (desain 05 bagian P; PLAN: tanpa tabel push receipt). */

/** Notifikasi PENDING yang diklaim per putaran. */
export const PUSH_BATCH = 500;
/** Batas pesan per request Expo. */
export const EXPO_PUSH_CHUNK = 100;
/** Total percobaan kirim (termasuk yang pertama) sebelum FAILED. */
export const PUSH_MAX_ATTEMPTS = 4;
/** Jeda percobaan ulang ke-1, ke-2, ke-3 (menit). */
export const PUSH_BACKOFF_MINUTES = [1, 5, 30] as const;
/** Notifikasi lebih tua dari ini tidak lagi dipush (SKIPPED "EXPIRED"); tetap ada di inbox. */
export const PUSH_MAX_AGE_MINUTES = 60;
export const PUSH_TITLE_MAX = 100;
export const PUSH_BODY_MAX = 178;
export const PUSH_ERROR_MAX = 255;
/**
 * Klaim = pushNextAttemptAt digeser ke now + lease (baris tetap PENDING). Proses mati di tengah kirim ->
 * baris layak lagi setelah lease habis (at-least-once). Nilai lease juga penjaga update akhir.
 */
export const PUSH_CLAIM_LEASE_MS = 120_000;
/** Anggaran satu putaran dispatcher (kick maupun tick). */
export const PUSH_DISPATCH_BUDGET_MS = 40_000;

/** Layar deep link bawaan bila notifikasi tidak membawa data.screen/id. */
export const DEFAULT_PUSH_SCREEN = "notification";

/** Kode pushError (tanpa PII: hanya kode, tidak pernah pesan mentah Expo yang memuat token). */
export const PUSH_ERROR = {
  EXPIRED: "EXPIRED",
  NO_DEVICE: "NO_DEVICE",
  DEVICE_NOT_REGISTERED: "DeviceNotRegistered",
  MISSING_TICKET: "MISSING_TICKET",
  NETWORK_ERROR: "NETWORK_ERROR",
  TOO_MANY_REQUESTS: "TOO_MANY_REQUESTS",
  UNKNOWN: "UNKNOWN_ERROR",
} as const;
