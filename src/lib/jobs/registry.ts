import { placeholderHandler } from "./placeholders";
import type { JobHandler, JobName } from "./types";

/**
 * Peta statis nama job → handler (tanpa registrasi lewat efek samping impor). Handler tidak
 * pernah menangkap error-nya sendiri secara diam-diam: runner yang mencatat FAILED/log.
 * Handler wajib berhenti sebelum ctx.deadline dan menghormati ctx.scope (untuk test).
 */
export const JOB_HANDLERS: Readonly<Record<JobName, JobHandler>> = {
  // Fase notifikasi/push: dispatchPendingPushes(ctx).
  "push-dispatch": placeholderHandler,
  // Fase absensi: per sekolah aktif → runKeyedJob("attendance-auto-alpha", schoolId, ymd, ...).
  "attendance-auto-alpha": placeholderHandler,
  // Fase storage: purgeOrphanFiles(ctx) (banner/berkas yatim).
  "files-orphan-cleanup": placeholderHandler,
  // Retensi harian: sesi mati, selfie, CheckInRejection, notifikasi, JobRun (kecuali auto-alpha).
  "maintenance-daily": placeholderHandler,
};
