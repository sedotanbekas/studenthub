import { localParts, parseLocalDate, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import {
  ADDRESS_MAX,
  ADDRESS_MIN,
  BIRTH_PLACE_MAX,
  GUARDIAN_NAME_MAX,
  NAME_MAX,
  NAME_MIN,
  STUDENT_AGE_MAX,
  STUDENT_AGE_MIN,
  isValidNis,
  isValidNisn,
  type GenderValue,
} from "./constants";
import { normalizeIdPhone } from "./phone";

/**
 * Kekurangan data wajib sebelum aktivasi (murni). Daftar kosong = siswa boleh diaktivasi.
 * Umur dihitung pada tanggal LOKAL sekolah (WIB/WITA/WIT).
 */
export type GapField =
  | "name"
  | "nisn"
  | "nis"
  | "gender"
  | "birthPlace"
  | "birthDate"
  | "address"
  | "guardianName"
  | "guardianPhone"
  | "currentClassId"
  | "school";

export type GapCode =
  | "REQUIRED"
  | "INVALID"
  | "AGE_OUT_OF_RANGE"
  | "CLASS_NOT_FOUND"
  | "CLASS_INACTIVE"
  | "CLASS_OTHER_SCHOOL"
  | "CLASS_NOT_CURRENT_YEAR"
  | "SCHOOL_INACTIVE";

export interface ActivationGap {
  readonly field: GapField;
  readonly code: GapCode;
  readonly message: string;
}

export interface ActivationClass {
  readonly id: string;
  readonly schoolId: string;
  readonly isActive: boolean;
  readonly academicYearId: string;
}

export interface ActivationInput {
  readonly name: string | null;
  readonly nisn: string | null;
  readonly nis: string | null;
  readonly gender: GenderValue | null;
  readonly birthPlace: string | null;
  readonly birthDate: LocalDate | null;
  readonly address: string | null;
  readonly guardianName: string | null;
  readonly guardianPhone: string | null;
  /** Id kelas yang diminta; `class` null sementara classId terisi = kelas tidak ditemukan. */
  readonly classId: string | null;
  readonly class: ActivationClass | null;
  readonly schoolId: string;
  readonly schoolActive: boolean;
  readonly timezone: SchoolTz;
  /** Tahun ajaran milik semester aktif sekolah; null bila belum ada semester aktif. */
  readonly activeAcademicYearId: string | null;
}

const LABELS: Readonly<Record<GapField, string>> = {
  name: "Nama lengkap",
  nisn: "NISN",
  nis: "NIS",
  gender: "Jenis kelamin",
  birthPlace: "Tempat lahir",
  birthDate: "Tanggal lahir",
  address: "Alamat",
  guardianName: "Nama wali",
  guardianPhone: "Nomor HP wali",
  currentClassId: "Kelas",
  school: "Sekolah",
};

const gap = (field: GapField, code: GapCode, message: string): ActivationGap => ({ field, code, message });
const required = (field: GapField): ActivationGap => gap(field, "REQUIRED", `${LABELS[field]} wajib diisi sebelum aktivasi.`);
const lengthIn = (value: string, min: number, max: number): boolean => value.length >= min && value.length <= max;

/** Umur dalam tahun penuh pada tanggal `today`. */
export function ageOn(birthDate: LocalDate, today: LocalDate): number {
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  const hadBirthday = tm > bm || (tm === bm && td >= bd);
  return ty - by - (hadBirthday ? 0 : 1);
}

type TextRule = { readonly field: GapField; readonly valid: (v: string) => boolean; readonly message: string };

const TEXT_RULES = {
  name: { field: "name", valid: (v: string) => lengthIn(v, NAME_MIN, NAME_MAX), message: `Nama lengkap harus ${NAME_MIN}–${NAME_MAX} karakter.` },
  nisn: { field: "nisn", valid: isValidNisn, message: "NISN harus 10 digit angka." },
  nis: { field: "nis", valid: isValidNis, message: "NIS hanya huruf, angka, titik, garis miring, atau tanda hubung (maks 20)." },
  birthPlace: { field: "birthPlace", valid: (v: string) => lengthIn(v, 1, BIRTH_PLACE_MAX), message: `Tempat lahir maksimal ${BIRTH_PLACE_MAX} karakter.` },
  address: { field: "address", valid: (v: string) => lengthIn(v, ADDRESS_MIN, ADDRESS_MAX), message: `Alamat harus ${ADDRESS_MIN}–${ADDRESS_MAX} karakter.` },
  guardianName: { field: "guardianName", valid: (v: string) => lengthIn(v, 1, GUARDIAN_NAME_MAX), message: `Nama wali maksimal ${GUARDIAN_NAME_MAX} karakter.` },
  guardianPhone: { field: "guardianPhone", valid: (v: string) => normalizeIdPhone(v) !== null, message: "Nomor HP wali tidak valid (contoh 081234567890)." },
} as const satisfies Record<string, TextRule>;

function textGap(rule: TextRule, value: string | null): ActivationGap[] {
  if (value === null || value.trim() === "") return [required(rule.field)];
  return rule.valid(value) ? [] : [gap(rule.field, "INVALID", rule.message)];
}

function birthDateGaps(input: ActivationInput, now: Date): ActivationGap[] {
  if (input.birthDate === null) return [required("birthDate")];
  if (parseLocalDate(input.birthDate) === null) return [gap("birthDate", "INVALID", "Tanggal lahir tidak valid.")];
  const age = ageOn(input.birthDate, localParts(now, input.timezone).ymd);
  if (age < STUDENT_AGE_MIN || age > STUDENT_AGE_MAX) {
    return [gap("birthDate", "AGE_OUT_OF_RANGE", `Umur siswa harus ${STUDENT_AGE_MIN}–${STUDENT_AGE_MAX} tahun.`)];
  }
  return [];
}

function classGaps(input: ActivationInput): ActivationGap[] {
  if (input.classId === null) return [required("currentClassId")];
  const klass = input.class;
  if (klass === null) return [gap("currentClassId", "CLASS_NOT_FOUND", "Kelas tidak ditemukan.")];
  if (klass.schoolId !== input.schoolId) return [gap("currentClassId", "CLASS_OTHER_SCHOOL", "Kelas bukan milik sekolah ini.")];
  if (!klass.isActive) return [gap("currentClassId", "CLASS_INACTIVE", "Kelas sudah dinonaktifkan.")];
  if (input.activeAcademicYearId !== null && klass.academicYearId !== input.activeAcademicYearId) {
    return [gap("currentClassId", "CLASS_NOT_CURRENT_YEAR", "Kelas bukan dari tahun ajaran semester aktif.")];
  }
  return [];
}

export function getActivationGaps(input: ActivationInput, now: Date): ActivationGap[] {
  return [
    ...textGap(TEXT_RULES.name, input.name),
    ...textGap(TEXT_RULES.nisn, input.nisn),
    ...textGap(TEXT_RULES.nis, input.nis),
    ...(input.gender === null ? [required("gender")] : []),
    ...textGap(TEXT_RULES.birthPlace, input.birthPlace),
    ...birthDateGaps(input, now),
    ...textGap(TEXT_RULES.address, input.address),
    ...textGap(TEXT_RULES.guardianName, input.guardianName),
    ...textGap(TEXT_RULES.guardianPhone, input.guardianPhone),
    ...classGaps(input),
    ...(input.schoolActive ? [] : [gap("school", "SCHOOL_INACTIVE", "Sekolah sedang nonaktif.")]),
  ];
}

/**
 * Kekurangan yang DIPERKENALKAN oleh PATCH pada siswa AKTIF: kekurangan pada field yang diubah,
 * atau kekurangan baru yang belum ada sebelumnya. Kekurangan lama pada field yang tidak disentuh
 * (mis. kelas tahun lalu sebelum kenaikan kelas) tidak menghalangi edit lain.
 */
export function newGapsAfterPatch(
  before: readonly ActivationGap[],
  after: readonly ActivationGap[],
  changedFields: ReadonlySet<GapField>,
): ActivationGap[] {
  const existing = new Set(before.map((g) => `${g.field}:${g.code}`));
  return after.filter((g) => changedFields.has(g.field) || !existing.has(`${g.field}:${g.code}`));
}
