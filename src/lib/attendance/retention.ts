/**
 * Aturan retensi murni untuk job maintenance-daily & files-orphan-cleanup (PLAN "File & job"):
 * selfie 180 hari (keputusan klien; baris absensi tetap), lampiran izin dibatalkan (segera) / ditolak
 * (30 hari), CheckInRejection 90 hari, token/sesi mati,
 * notifikasi 1 tahun, JobRun 90 hari (auto-alpha 400 hari karena dipakai analitik "hari tertutup").
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const SELFIE_RETENTION_DAYS = 180;
/** Lampiran izin DITOLAK dimusnahkan 30 hari setelah ditinjau (masa sanggah); izin DIBATALKAN segera. */
export const REJECTED_LEAVE_ATTACHMENT_DAYS = 30;
export const REJECTION_RETENTION_DAYS = 90;
/** RefreshToken yang sudah ditukar lebih dari 30 hari lalu (jendela deteksi reuse sudah lewat). */
export const ROTATED_REFRESH_TOKEN_DAYS = 30;
/** RefreshToken kedaluwarsa lebih dari 1 hari lalu. */
export const EXPIRED_REFRESH_TOKEN_DAYS = 1;
/** AuthSession dicabut/kedaluwarsa lebih dari 90 hari lalu (RefreshToken ikut terhapus kaskade). */
export const DEAD_SESSION_DAYS = 90;
export const NOTIFICATION_RETENTION_DAYS = 365;
export const JOB_RUN_RETENTION_DAYS = 90;
export const AUTO_ALPHA_RUN_RETENTION_DAYS = 400;
/** Banner yang tidak pernah dirujuk iklan dianggap yatim setelah 24 jam. */
export const ORPHAN_FILE_MIN_AGE_HOURS = 24;

/** Ukuran batch hapus berkas (byte di disk lalu baris). */
export const FILE_PURGE_BATCH = 500;
/** Ukuran DELETE ... LIMIT untuk tabel besar (notifikasi, JobRun, penolakan check-in). */
export const DELETE_CHUNK = 5000;

export interface RetentionCutoffs {
  readonly selfie: Date;
  readonly rejectedLeaveAttachment: Date;
  readonly rejection: Date;
  readonly rotatedRefreshToken: Date;
  readonly expiredRefreshToken: Date;
  readonly deadSession: Date;
  readonly notification: Date;
  readonly jobRun: Date;
  readonly autoAlphaRun: Date;
}

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/** Semua tenggat (baris dengan waktu < tenggat dibersihkan). */
export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    selfie: daysAgo(now, SELFIE_RETENTION_DAYS),
    rejectedLeaveAttachment: daysAgo(now, REJECTED_LEAVE_ATTACHMENT_DAYS),
    rejection: daysAgo(now, REJECTION_RETENTION_DAYS),
    rotatedRefreshToken: daysAgo(now, ROTATED_REFRESH_TOKEN_DAYS),
    expiredRefreshToken: daysAgo(now, EXPIRED_REFRESH_TOKEN_DAYS),
    deadSession: daysAgo(now, DEAD_SESSION_DAYS),
    notification: daysAgo(now, NOTIFICATION_RETENTION_DAYS),
    jobRun: daysAgo(now, JOB_RUN_RETENTION_DAYS),
    autoAlphaRun: daysAgo(now, AUTO_ALPHA_RUN_RETENTION_DAYS),
  };
}

export function orphanFileCutoff(now: Date): Date {
  return new Date(now.getTime() - ORPHAN_FILE_MIN_AGE_HOURS * HOUR_MS);
}

/** Masih ada sisa anggaran waktu tick? `deadline` = epoch ms jam dinding (JobContext.deadline). */
export function hasTimeLeft(deadline: number, clock: () => number = Date.now): boolean {
  return clock() < deadline;
}
