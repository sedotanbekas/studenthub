/** Batas impor siswa (desain auth §20). */
const MIB = 1024 * 1024;

export const IMPORT_MAX_FILE_BYTES = 2 * MIB;
/** Batas body multipart: berkas 2 MiB + ruang untuk boundary & field lain. */
export const IMPORT_MAX_BODY_BYTES = IMPORT_MAX_FILE_BYTES + 64 * 1024;
/** Total isi XLSX setelah dekompresi (guard zip-bomb): 2 MiB XLSX wajar jauh di bawah ini. */
export const IMPORT_MAX_UNCOMPRESSED_BYTES = 8 * MIB;
export const IMPORT_MAX_ROWS = 1000;
export const IMPORT_MAX_COLUMNS = 64;
export const IMPORT_TX_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;
/** Paralelisme hash bcrypt (threadpool libuv) saat membuat kata sandi massal. */
export const IMPORT_HASH_CONCURRENCY = 8;
export const IMPORT_CREATE_CHUNK = 500;

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
