/**
 * Konstanta domain iklan (siklus iklan, penayangan, impresi/klik, analitik). Satu sumber untuk aturan
 * murni, skema zod, dan deskripsi OpenAPI. Hari analitik & penagihan = WIB.
 */

// ----------------------------------------------------------------------------- iklan
export const AD_TITLE_MIN = 3;
export const AD_TITLE_MAX = 100;
export const AD_URL_MAX = 2_000;
export const AD_MIN_DURATION_MS = 3_600_000;
export const AD_MAX_DURATION_DAYS = 366;
export const AD_MAX_START_LEAD_DAYS = 365;
export const MAX_TARGETS_PER_AD = 100;
export const MAX_NON_ARCHIVED_ADS_PER_SPONSOR = 50;
export const REVIEW_NOTE_MIN = 5;
export const REVIEW_NOTE_MAX = 255;
export const AD_STATUSES = ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "PAUSED", "ARCHIVED"] as const;
export const AD_LINK_TYPES = ["EXTERNAL_URL", "DEEP_LINK"] as const;
export const AD_TARGET_SCOPES = ["ALL", "PROVINCE", "CITY", "SCHOOL"] as const;
/** Status tampilan turunan (ENDED tidak disimpan; "Aktif" di UI = LIVE). */
export const AD_DISPLAY_STATUSES = [
  "DRAFT", "PENDING_REVIEW", "REJECTED", "ARCHIVED", "ENDED", "PAUSED", "SPONSOR_INACTIVE", "SCHEDULED", "NO_BALANCE", "LIVE",
] as const;
/** Banner multipart maks 5 MiB (UPLOAD_POLICY.AD_BANNER) + ruang header multipart. */
export const BANNER_MAX_BODY_BYTES = 5 * 1024 * 1024 + 16 * 1024;

// ----------------------------------------------------------------------------- penayangan & event
export const MAX_ADS_PER_SLIDER = 5;
export const MAX_ADS_PER_SPONSOR_IN_SLIDER = 2;
export const MAX_SERVE_CANDIDATES = 200;
export const SERVE_REFRESH_HINT_SECONDS = 1_800;
export const AD_TOKEN_TTL_SECONDS = 21_600;
export const AD_TOKEN_AUDIENCE = "sh-ad-event";
export const AD_TOKEN_ISSUER = "studenthub";
export const IMPRESSION_DEDUPE_WINDOW_MS = 1_800_000;
/** Klik tanpa impresi dalam jendela ini sebelumnya = SUSPECT (tidak ditagih). */
export const CLICK_IMPRESSION_WINDOW_MS = 1_800_000;
/** Akun siswa yang aktif kurang dari ini = klik SUSPECT (tidak ditagih). */
export const NEW_STUDENT_MIN_AGE_DAYS = 7;
export const IMPRESSION_BATCH_MAX = 20;
export const IMPRESSION_STORE_MAX_ENTRIES = 200_000;
export const DEVICE_TYPES = ["MOBILE", "TABLET", "DESKTOP"] as const;
/** Nilai `Device.deviceType` expo-device yang dikirim app; dinormalisasi lewat mapDeviceType. */
export const REPORTED_DEVICE_TYPES = [...DEVICE_TYPES, "PHONE", "TV", "UNKNOWN"] as const;
export const CLICK_TX = { timeout: 5_000, maxWait: 3_000 } as const;

// ----------------------------------------------------------------------------- analitik
export const ANALYTICS_MAX_RANGE_DAYS = 92;
export const ANALYTICS_PRESETS = { "7d": 7, "30d": 30 } as const;
export const ANALYTICS_SORTS = ["clicks", "impressions", "ctr", "spend"] as const;
export const PER_AD_TABLE_MAX_ADS = 500;
