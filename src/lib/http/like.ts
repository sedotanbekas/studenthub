/**
 * Peloloskan wildcard LIKE untuk input pencarian pengguna. Prisma (MariaDB) menerjemahkan filter
 * `contains`/`startsWith`/`endsWith` menjadi `LIKE CONCAT('%', ?, '%')` TANPA meloloskan `%`, `_`, dan `\`
 * di dalam nilai, sehingga `q=%` cocok dengan semua baris. Karakter escape default LIKE di MariaDB adalah
 * backslash (sql_mode tanpa NO_BACKSLASH_ESCAPES).
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Kata kunci pencarian opsional yang siap dipakai di contains/startsWith; kosong/undefined -> null. */
export function likeSearch(q: string | undefined): string | null {
  return q ? escapeLike(q) : null;
}
