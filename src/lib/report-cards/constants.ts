/**
 * Konstanta domain rapor (desain 03 §E). Satu tempat untuk batas permintaan & nama kunci aplikasi.
 */
export const MAX_BULK_GRADE_ROWS = 100;
export const MAX_CARD_GRADE_ROWS = 40;
export const MAX_PUBLISH_BATCH = 100;
export const MAX_UNPUBLISH_BATCH = 100;
export const DESCRIPTION_MAX = 500;
export const UNPUBLISH_REASON_MIN = 5;
export const UNPUBLISH_REASON_MAX = 255;
export const SEARCH_QUERY_MAX = 100;
/** Batas aman roster satu kelas (siswa aktif + pemegang rapor). */
export const MAX_ROSTER = 1000;
/** Rapor terbit milik satu siswa (≈ 2 per tahun ajaran). */
export const MAX_OWN_REPORT_CARDS = 100;
export const REPORT_CARD_LINK_SCREEN = "report-card";

/**
 * Kunci aplikasi (AppLock, `lockKey()` di src/lib/tx.ts) untuk SEMUA penulis rapor satu kelas pada satu
 * semester: input nilai massal/per rapor, buat & hapus rapor, terbit, tarik terbit. Diambil PALING AWAL
 * di transaksi (sebelum membaca & sebelum `ReportCard ... FOR UPDATE`). Beberapa kunci sekaligus (tarik
 * terbit lintas kelas) diambil urut naik string kunci. Tidak digabung dengan kunci aplikasi lain.
 */
export const gradesLockKey = (termId: string, classId: string): string => `grades:${termId}:${classId}`;
