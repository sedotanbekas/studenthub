import { cellText } from "./cell-parsers";

/**
 * Pencocokan header impor (murni). Pencocokan mengabaikan huruf besar/kecil, isi dalam kurung,
 * tanda baca, dan spasi berlebih; menerima alias umum dari templat sekolah.
 */
export const IMPORT_FIELDS = [
  "nisn",
  "nis",
  "name",
  "gender",
  "birthPlace",
  "birthDate",
  "address",
  "guardianName",
  "guardianPhone",
  "className",
  "sppAmount",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export type ColumnMap = Readonly<Partial<Record<ImportField, number>>>;

/** Label kolom pada templat XLSX (juga dipakai pesan error). */
export const HEADER_LABELS: Readonly<Record<ImportField, string>> = {
  nisn: "NISN",
  nis: "NIS",
  name: "Nama Lengkap",
  gender: "Jenis Kelamin",
  birthPlace: "Tempat Lahir",
  birthDate: "Tanggal Lahir",
  address: "Alamat",
  guardianName: "Nama Wali",
  guardianPhone: "No HP Wali",
  className: "Kelas",
  sppAmount: "SPP",
};

const HEADER_ALIASES: Readonly<Record<ImportField, readonly string[]>> = {
  nisn: ["nisn"],
  nis: ["nis", "nomor induk siswa"],
  name: ["nama", "nama lengkap", "nama siswa"],
  gender: ["jenis kelamin", "jk", "kelamin"],
  birthPlace: ["tempat lahir"],
  birthDate: ["tanggal lahir", "tgl lahir"],
  address: ["alamat"],
  guardianName: ["nama wali", "nama orang tua", "nama orang tua wali"],
  guardianPhone: ["no hp wali", "hp wali", "nomor hp wali", "no telp wali", "telepon wali"],
  className: ["kelas", "nama kelas", "rombel"],
  sppAmount: ["spp", "tarif spp", "nominal spp"],
};

export const ALWAYS_REQUIRED: readonly ImportField[] = ["nisn", "nis", "name", "gender"];
export const ACTIVATION_REQUIRED: readonly ImportField[] = ["birthPlace", "birthDate", "address", "guardianName", "guardianPhone", "className"];

export function normalizeHeader(value: unknown): string {
  const text = cellText(value);
  if (text === null) return "";
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const ALIAS_TO_FIELD: ReadonlyMap<string, ImportField> = new Map(
  IMPORT_FIELDS.flatMap((field) => HEADER_ALIASES[field].map((alias) => [alias, field] as const)),
);

export interface HeaderMatch {
  readonly columns: ColumnMap;
  readonly missing: ImportField[];
  readonly duplicates: ImportField[];
}

export function matchHeaders(header: readonly unknown[], activate: boolean): HeaderMatch {
  const columns: Partial<Record<ImportField, number>> = {};
  const duplicates = new Set<ImportField>();
  header.forEach((cell, index) => {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(cell));
    if (field === undefined) return;
    if (columns[field] === undefined) columns[field] = index;
    else duplicates.add(field);
  });
  const required = activate ? [...ALWAYS_REQUIRED, ...ACTIVATION_REQUIRED] : ALWAYS_REQUIRED;
  return {
    columns,
    missing: required.filter((field) => columns[field] === undefined),
    duplicates: IMPORT_FIELDS.filter((field) => duplicates.has(field)),
  };
}
