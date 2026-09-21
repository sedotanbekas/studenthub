import { placeholderHandler } from "./placeholders";
import type { JobHandler, JobName } from "./types";

/**
 * Handler dimuat malas (dynamic import) agar registry tetap ringan: modul job memuat Prisma/storage,
 * sedangkan registry juga diimpor test unit tanpa database.
 */
const autoAlpha: JobHandler = async (ctx) => (await import("@/lib/attendance/auto-alpha-job")).runAutoAlpha(ctx);
const orphanFilesCleanup: JobHandler = async (ctx) => (await import("./files-cleanup")).runOrphanFilesCleanup(ctx);
const maintenanceDaily: JobHandler = async (ctx) => (await import("./maintenance")).runMaintenanceDaily(ctx);

/**
 * Peta statis nama job → handler (tanpa registrasi lewat efek samping impor). Handler tidak
 * pernah menangkap error-nya sendiri secara diam-diam: runner yang mencatat FAILED/log.
 * Handler wajib berhenti sebelum ctx.deadline dan menghormati ctx.scope (untuk test).
 */
export const JOB_HANDLERS: Readonly<Record<JobName, JobHandler>> = {
  // Fase notifikasi/push: dispatchPendingPushes(ctx).
  "push-dispatch": placeholderHandler,
  // Per sekolah aktif → runKeyedJob("auto-alpha", schoolId, tanggal lokal, tutup hari) + catch-up 7 hari.
  "attendance-auto-alpha": autoAlpha,
  // Banner iklan yatim (> 24 jam, tidak dirujuk iklan): byte lalu baris.
  "files-orphan-cleanup": orphanFilesCleanup,
  // Retensi harian: selfie 180 hari, CheckInRejection 90 hari, token/sesi mati, notifikasi, JobRun.
  "maintenance-daily": maintenanceDaily,
};
