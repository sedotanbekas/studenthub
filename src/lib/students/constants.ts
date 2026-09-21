/**
 * Konstanta domain siswa (murni, tanpa Prisma). Dipakai validasi request, aturan aktivasi, dan impor.
 */
export const NISN_PATTERN = /^\d{10}$/;
export const NIS_PATTERN = /^[A-Za-z0-9./-]{1,20}$/;
export const NAME_MIN = 3;
export const NAME_MAX = 100;
export const BIRTH_PLACE_MAX = 100;
export const GUARDIAN_NAME_MAX = 100;
export const ADDRESS_MIN = 10;
export const ADDRESS_MAX = 500;
export const STUDENT_AGE_MIN = 5;
export const STUDENT_AGE_MAX = 25;
export const SPP_AMOUNT_MAX = 50_000_000;
export const STATUS_REASON_MIN = 3;
export const STATUS_REASON_MAX = 255;
export const SEARCH_QUERY_MAX = 100;

export const STUDENT_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "GRADUATED", "MOVED"] as const;
export type StudentStatusValue = (typeof STUDENT_STATUSES)[number];
export const GENDERS = ["MALE", "FEMALE"] as const;
export type GenderValue = (typeof GENDERS)[number];

/** Status default daftar siswa admin (LULUS & PINDAH disembunyikan kecuali diminta). */
export const DEFAULT_LIST_STATUSES: readonly StudentStatusValue[] = ["ACTIVE", "INACTIVE", "DRAFT"];

/** NISN sah: tepat 10 digit dan bukan "0000000000". */
export function isValidNisn(value: string): boolean {
  return NISN_PATTERN.test(value) && value !== "0000000000";
}

export function isValidNis(value: string): boolean {
  return NIS_PATTERN.test(value);
}

/** Rapikan spasi berulang & tepi; string kosong -> null. */
export function collapseText(value: string): string | null {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length === 0 ? null : collapsed;
}
