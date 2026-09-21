/**
 * Konstanta domain izin/sakit (docs/design/02-attendance.md D23 + PLAN "Absensi").
 * Semua tanggal adalah tanggal LOKAL sekolah; "hari ini" ditentukan jam server (ctx.now).
 */

/** Siswa boleh mengajukan mundur paling jauh 7 hari dari hari ini (tanggal mulai >= hari ini - 7). */
export const LEAVE_MAX_BACKDATE_DAYS = 7;
/** Admin yang menginput atas nama siswa boleh mundur 30 hari. */
export const LEAVE_ADMIN_MAX_BACKDATE_DAYS = 30;
/** Tanggal selesai paling jauh hari ini + 30. */
export const LEAVE_MAX_ADVANCE_DAYS = 30;
/** Rentang maksimal 14 hari kalender (inklusif). */
export const LEAVE_MAX_SPAN_DAYS = 14;
/** SAKIT yang mencakup >= 3 hari sekolah wajib melampirkan foto surat/bukti. */
export const SICK_NOTE_REQUIRED_MIN_SCHOOL_DAYS = 3;

export const LEAVE_REASON_MIN = 10;
export const LEAVE_REASON_MAX = 500;
/** Catatan peninjau: wajib 5..255 saat menolak, opsional (<= 255) saat menyetujui. */
export const REVIEW_NOTE_MIN = 5;
export const REVIEW_NOTE_MAX = 255;
export const SEARCH_QUERY_MAX = 100;

/** Batas body multipart pengajuan: lampiran maks 8 MiB (UPLOAD_POLICY) + ruang field teks. */
export const LEAVE_MAX_BODY_BYTES = 8 * 1024 * 1024 + 64 * 1024;

/**
 * Pengajuan izin siswa per hari lokal sekolah (termasuk yang kemudian dibatalkan): membatasi loop
 * ajukan-batal yang memenuhi disk dengan lampiran dan membanjiri admin dengan notifikasi.
 */
export const LEAVE_DAILY_SUBMISSION_LIMIT = 5;

/** Percobaan ulang bila insert baris absensi bentrok dengan auto-ALPHA yang berjalan bersamaan. */
export const MATERIALIZE_MAX_RETRIES = 3;

export const LEAVE_TYPES = ["IZIN", "SAKIT"] as const;
export type LeaveTypeValue = (typeof LEAVE_TYPES)[number];

export const REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;
export type ReviewStatusValue = (typeof REVIEW_STATUSES)[number];
