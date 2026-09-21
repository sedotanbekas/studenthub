/** Konstanta modul job cron (desain 05, bagian J). */

/** RUNNING lebih tua dari ini dianggap macet (proses mati) dan boleh diambil alih. */
export const JOB_STALE_MINUTES = 15;
export const JOB_STALE_MS = JOB_STALE_MINUTES * 60_000;

/** Batas percobaan per kunci JobRun; setelah itu tetap FAILED dan terlihat di /platform/job-runs. */
export const JOB_MAX_ATTEMPTS = 5;

/** Panjang maksimal pesan error yang disimpan di JobRun.error. */
export const JOB_ERROR_MAX_CHARS = 2000;

/** Anggaran satu tick (cron memanggil tiap menit, curl -m 55). */
export const TICK_BUDGET_MS = 50_000;

/** maintenance-daily jatuh tempo pada tick pertama pukul >= 19:00 UTC (02:00 WIB). */
export const DAILY_MAINTENANCE_UTC_HOUR = 19;

/** scopeKey JobRun untuk job yang tidak dipecah per sekolah. */
export const GLOBAL_SCOPE_KEY = "global";

/** Segmen URL untuk menjalankan semua job yang jatuh tempo. */
export const TICK_JOB = "tick";
