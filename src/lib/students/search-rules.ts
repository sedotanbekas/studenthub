import { DEFAULT_LIST_STATUSES, STUDENT_STATUSES, collapseText, type StudentStatusValue } from "./constants";

/**
 * Aturan pencarian daftar siswa (murni). Prisma TIDAK meloloskan wildcard LIKE pada contains/
 * startsWith (MariaDB), jadi `%`, `_`, dan `\` diloloskan manual dengan backslash.
 */
export interface StudentSearch {
  readonly nameContains: string;
  readonly nisPrefix: string;
  /** Hanya bila q seluruhnya digit. */
  readonly nisnPrefix: string | null;
}

export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** q semua digit: awalan NIS ATAU awalan NISN ATAU nama memuat q; selain itu nama memuat ATAU awalan NIS. */
export function parseStudentSearch(q: string | undefined): StudentSearch | null {
  const clean = q === undefined ? null : collapseText(q);
  if (clean === null) return null;
  const escaped = escapeLike(clean);
  return { nameContains: escaped, nisPrefix: escaped, nisnPrefix: /^\d+$/.test(clean) ? escaped : null };
}

/** "ACTIVE,GRADUATED" -> daftar unik; undefined -> default; token tak dikenal -> null. */
export function parseStatusList(raw: string | undefined): StudentStatusValue[] | null {
  if (raw === undefined) return [...DEFAULT_LIST_STATUSES];
  const tokens = raw.split(",").map((t) => t.trim().toUpperCase()).filter((t) => t.length > 0);
  if (tokens.length === 0) return null;
  const known = new Set<string>(STUDENT_STATUSES);
  if (!tokens.every((t) => known.has(t))) return null;
  return [...new Set(tokens)] as StudentStatusValue[];
}
