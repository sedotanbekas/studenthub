import type { JobHandler } from "./types";

/** Status hasil handler yang belum diisi fase domain. */
export const PLACEHOLDER_STATUS = "belum-diimplementasi";

/**
 * Handler sementara P0: tidak menyentuh data. Fase domain mengganti entrinya di registry.ts
 * (push → dispatchPendingPushes, absensi → runAutoAlphaForSchool per sekolah, storage →
 * purgeOrphanFiles, maintenance → retensi sesi/selfie/CheckInRejection/notifikasi/JobRun).
 */
export const placeholderHandler: JobHandler = async () => ({ status: PLACEHOLDER_STATUS });
