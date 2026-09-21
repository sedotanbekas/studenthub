import { inclusiveDays, rangeContains, rangesOverlap, type DateRange, type RuleViolation } from "@/lib/calendar/ranges";

/**
 * Aturan murni struktur akademik: tahun ajaran, semester, kelas, mapel (tanpa Prisma).
 */
export type SemesterCode = "GANJIL" | "GENAP";

export const MAX_ACADEMIC_YEAR_DAYS = 400;
export const MAX_TERM_DAYS = 200;
export const SUBJECT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;
export const ACADEMIC_YEAR_NAME_PATTERN = /^(\d{4})\/(\d{4})$/;

const SEMESTER_LABEL: Readonly<Record<SemesterCode, string>> = { GANJIL: "Ganjil", GENAP: "Genap" };

export interface TermInput extends DateRange {
  readonly semester: SemesterCode;
}

/** "2025/2026" -> { startYear: 2025 }; tahun kedua wajib = tahun pertama + 1. */
export function parseAcademicYearName(name: string): { startYear: number } | null {
  const match = ACADEMIC_YEAR_NAME_PATTERN.exec(name);
  if (!match) return null;
  const startYear = Number(match[1]);
  return Number(match[2]) === startYear + 1 ? { startYear } : null;
}

export const termLabel = (semester: SemesterCode, yearName: string): string => `Semester ${SEMESTER_LABEL[semester]} ${yearName}`;

const INVALID_RANGE: RuleViolation = { code: "INVALID_DATE_RANGE", message: "Tanggal mulai harus sebelum tanggal selesai." };

export function validateAcademicYear(input: DateRange & { readonly name: string }): RuleViolation | null {
  const parsed = parseAcademicYearName(input.name);
  if (!parsed) return { code: "ACADEMIC_YEAR_NAME_INVALID", message: "Nama tahun ajaran harus berformat YYYY/YYYY+1, mis. 2025/2026." };
  if (input.startDate >= input.endDate) return INVALID_RANGE;
  if (inclusiveDays(input) > MAX_ACADEMIC_YEAR_DAYS) {
    return { code: "ACADEMIC_YEAR_TOO_LONG", message: `Rentang tahun ajaran maksimal ${MAX_ACADEMIC_YEAR_DAYS} hari.` };
  }
  if (Number(input.startDate.slice(0, 4)) !== parsed.startYear) {
    return { code: "ACADEMIC_YEAR_NAME_MISMATCH", message: `Tanggal mulai tahun ajaran ${input.name} harus berada di tahun ${parsed.startYear}.` };
  }
  return null;
}

/** Tahun ajaran lain (sekolah yang sama) yang beririsan; pemanggil sudah mengecualikan dirinya sendiri. */
export function findOverlappingYear<T extends DateRange>(candidate: DateRange, others: readonly T[]): T | null {
  return others.find((other) => rangesOverlap(candidate, other)) ?? null;
}

export function validateYearContainsTerms(year: DateRange, terms: readonly DateRange[]): RuleViolation | null {
  if (terms.every((term) => rangeContains(year, term))) return null;
  return { code: "ACADEMIC_YEAR_EXCLUDES_TERMS", message: "Rentang tahun ajaran harus tetap mencakup semua semesternya." };
}

function semesterOrderValid(term: TermInput, sibling: TermInput): boolean {
  const [ganjil, genap] = term.semester === "GANJIL" ? [term, sibling] : [sibling, term];
  return ganjil.endDate < genap.startDate;
}

/** Semester di dalam tahun ajarannya, maks. 200 hari, dan Ganjil selesai sebelum Genap dimulai. */
export function validateTerm(term: TermInput, year: DateRange, sibling: TermInput | null): RuleViolation | null {
  if (term.startDate >= term.endDate) return INVALID_RANGE;
  if (inclusiveDays(term) > MAX_TERM_DAYS) return { code: "TERM_TOO_LONG", message: `Rentang semester maksimal ${MAX_TERM_DAYS} hari.` };
  if (!rangeContains(year, term)) return { code: "TERM_OUTSIDE_YEAR", message: "Semester harus berada di dalam rentang tahun ajarannya." };
  if (sibling && sibling.semester !== term.semester && !semesterOrderValid(term, sibling)) {
    return { code: "TERM_ORDER_INVALID", message: "Semester Ganjil harus selesai sebelum Semester Genap dimulai." };
  }
  return null;
}

export const normalizeSubjectCode = (raw: string): string => raw.trim().toUpperCase();
export const isValidSubjectCode = (code: string): boolean => SUBJECT_CODE_PATTERN.test(code);

/** Trim + rapatkan spasi berulang. */
export const normalizeName = (raw: string): string => raw.trim().replace(/\s+/g, " ");
