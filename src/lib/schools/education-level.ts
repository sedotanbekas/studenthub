import type { RuleViolation } from "@/lib/calendar/ranges";

/**
 * Jenjang sekolah (murni, aman dipakai klien). Basis data selalu menyimpan KELAS NASIONAL 1..12 agar
 * semua sekolah seragam; tampilan memakai TINGKAT RELATIF dalam jenjangnya (SMK: tingkat 1..3 =
 * kelas 10..12). Sekolah tanpa jenjang menampilkan kelas nasional apa adanya.
 */
export const EDUCATION_LEVELS = ["SD", "MI", "SMP", "MTS", "SMA", "MA", "SMK", "MAK"] as const;
export type EducationLevel = (typeof EDUCATION_LEVELS)[number];

export const EDUCATION_LEVEL_LABELS: Readonly<Record<EducationLevel, string>> = {
  SD: "SD",
  MI: "MI",
  SMP: "SMP",
  MTS: "MTs",
  SMA: "SMA",
  MA: "MA",
  SMK: "SMK",
  MAK: "MAK",
};

export const EDUCATION_LEVEL_NAMES: Readonly<Record<EducationLevel, string>> = {
  SD: "Sekolah Dasar",
  MI: "Madrasah Ibtidaiyah",
  SMP: "Sekolah Menengah Pertama",
  MTS: "Madrasah Tsanawiyah",
  SMA: "Sekolah Menengah Atas",
  MA: "Madrasah Aliyah",
  SMK: "Sekolah Menengah Kejuruan",
  MAK: "Madrasah Aliyah Kejuruan",
};

export interface GradeSpan {
  readonly first: number;
  readonly last: number;
}

export const NATIONAL_GRADE_MIN = 1;
export const NATIONAL_GRADE_MAX = 12;

const SPANS: Readonly<Record<EducationLevel, GradeSpan>> = {
  SD: { first: 1, last: 6 },
  MI: { first: 1, last: 6 },
  SMP: { first: 7, last: 9 },
  MTS: { first: 7, last: 9 },
  SMA: { first: 10, last: 12 },
  MA: { first: 10, last: 12 },
  SMK: { first: 10, last: 12 },
  MAK: { first: 10, last: 12 },
};

export const isEducationLevel = (value: unknown): value is EducationLevel => (EDUCATION_LEVELS as readonly unknown[]).includes(value);

export function gradeSpan(level: EducationLevel): GradeSpan {
  return SPANS[level];
}

/** Kelas nasional -> tingkat relatif dalam jenjang; null bila kelas di luar jenjang. */
export function relativeGrade(level: EducationLevel, national: number): number | null {
  const { first, last } = gradeSpan(level);
  return national >= first && national <= last ? national - first + 1 : null;
}

/** Tingkat relatif -> kelas nasional; RangeError bila tingkat di luar jenjang. */
export function nationalGrade(level: EducationLevel, relative: number): number {
  const { first, last } = gradeSpan(level);
  const national = first + relative - 1;
  if (!Number.isInteger(relative) || relative < 1 || national > last) throw new RangeError(`Tingkat ${relative} tidak ada pada jenjang ${EDUCATION_LEVEL_LABELS[level]}.`);
  return national;
}

export function isGradeInLevel(level: EducationLevel | null, national: number): boolean {
  if (level === null) return national >= NATIONAL_GRADE_MIN && national <= NATIONAL_GRADE_MAX;
  return relativeGrade(level, national) !== null;
}

/** "Tingkat 3 (kelas 12)" bila tingkat relatif berbeda dari kelas nasional; selain itu "Kelas n". */
export function gradeLabel(level: EducationLevel | null, national: number): string {
  const relative = level === null ? null : relativeGrade(level, national);
  if (relative === null || relative === national) return `Kelas ${national}`;
  return `Tingkat ${relative} (kelas ${national})`;
}

export interface GradeOption {
  readonly value: number;
  readonly label: string;
}

export function gradeOptions(level: EducationLevel | null): GradeOption[] {
  const { first, last } = level === null ? { first: NATIONAL_GRADE_MIN, last: NATIONAL_GRADE_MAX } : gradeSpan(level);
  return Array.from({ length: last - first + 1 }, (_, index) => ({ value: first + index, label: gradeLabel(level, first + index) }));
}

/**
 * Kelas yang tersimpan di luar jenjang tetapi masih masuk akal sebagai tingkat relatif (mis. SMK "3")
 * -> kelas nasional yang dimaksud (12). null bila sudah sesuai atau tidak bisa ditebak.
 */
export function suggestGradeFix(level: EducationLevel | null, national: number): number | null {
  if (level === null || isGradeInLevel(level, national)) return null;
  const { first, last } = gradeSpan(level);
  return national >= 1 && national <= last - first + 1 ? first + national - 1 : null;
}

export function gradeLevelViolation(level: EducationLevel | null, national: number): RuleViolation | null {
  if (isGradeInLevel(level, national)) return null;
  if (level === null) return { code: "GRADE_LEVEL_OUT_OF_RANGE", message: `Tingkat kelas harus kelas ${NATIONAL_GRADE_MIN} sampai ${NATIONAL_GRADE_MAX}.` };
  const { first, last } = gradeSpan(level);
  return {
    code: "GRADE_LEVEL_OUTSIDE_EDUCATION_LEVEL",
    message: `Jenjang ${EDUCATION_LEVEL_LABELS[level]} hanya memiliki kelas ${first} sampai ${last} (tingkat 1 sampai ${last - first + 1}).`,
  };
}

/** Admin sekolah mengisi jenjang SEKALI (saat masih kosong); setelah itu hanya SUPER_ADMIN yang boleh mengubah. */
export function educationLevelChangeViolation(input: { current: EducationLevel | null; next: EducationLevel; isSuperAdmin: boolean }): RuleViolation | null {
  if (input.isSuperAdmin || input.current === null || input.current === input.next) return null;
  return { code: "EDUCATION_LEVEL_LOCKED", message: "Jenjang sekolah sudah diatur. Hubungi super admin studenthub.id untuk mengubahnya." };
}
