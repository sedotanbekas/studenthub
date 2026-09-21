import type { LocalDate, SchoolTz } from "@/lib/time/zone";
import { getActivationGaps, type ActivationClass, type ActivationInput, type GapField } from "../activation-rules";
import { ADDRESS_MAX, BIRTH_PLACE_MAX, GUARDIAN_NAME_MAX, type GenderValue, type StudentStatusValue } from "../constants";
import {
  cellText,
  normalizeClassName,
  parseDateCell,
  parseGenderCell,
  parseNameCell,
  parseNisCell,
  parseNisnCell,
  parsePhoneCell,
  parseSppCell,
  parseTextCell,
  type CellResult,
} from "./cell-parsers";
import { IMPORT_FIELDS, type ColumnMap, type ImportField } from "./headers";

/**
 * Validasi baris impor (murni). Tahap 1 `parseImportRows`: parse sel + cocokkan kelas. Tahap 2
 * `validateImportRows`: cek lintas baris (duplikat di berkas), hasil lookup DB (NISN/NIS di sekolah,
 * pemegang activeNisn di sekolah lain), dan kekurangan aktivasi bila activate=true.
 */
export interface ImportClass extends ActivationClass {
  readonly name: string;
}
export type ClassLookup = ReadonlyMap<string, ImportClass | "AMBIGUOUS">;

export interface RawImportRow {
  /** Nomor baris spreadsheet (header = baris 1). */
  readonly row: number;
  readonly values: readonly unknown[];
}

export interface ParsedImportRow {
  readonly row: number;
  readonly nisn: string | null;
  readonly nis: string | null;
  readonly name: string | null;
  readonly gender: GenderValue | null;
  readonly birthPlace: string | null;
  readonly birthDate: LocalDate | null;
  readonly address: string | null;
  readonly guardianName: string | null;
  readonly guardianPhone: string | null;
  readonly className: string | null;
  readonly class: ImportClass | null;
  readonly sppAmount: number | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  /** Field yang formatnya salah: tidak dilaporkan ulang sebagai kekurangan aktivasi. */
  readonly invalidFields: readonly GapField[];
}

export interface ImportLookups {
  /** NISN yang sudah ada di sekolah ini. */
  readonly existingNisns: ReadonlySet<string>;
  /** NIS (HURUF BESAR) yang sudah ada di sekolah ini. */
  readonly existingNisKeys: ReadonlySet<string>;
  /** Pemegang activeNisn di sekolah LAIN: NISN -> status. */
  readonly holders: ReadonlyMap<string, StudentStatusValue>;
}

export interface ActivationContext {
  readonly schoolId: string;
  readonly schoolActive: boolean;
  readonly timezone: SchoolTz;
  readonly activeAcademicYearId: string | null;
  readonly now: Date;
}

export interface ImportReportRow {
  readonly row: number;
  readonly nisn: string | null;
  readonly name: string | null;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface ImportReport {
  readonly totalRows: number;
  readonly validRows: number;
  readonly errorRows: number;
  readonly warningRows: number;
  readonly rows: readonly ImportReportRow[];
}

export interface ValidatedImport {
  readonly report: ImportReport;
  readonly rows: readonly ParsedImportRow[];
  /** Nomor baris yang NISN-nya dipegang siswa LULUS di sekolah lain (hanya saat activate=true). */
  readonly graduateRows: readonly number[];
}

/** Kelas aktif di tahun ajaran semester aktif (atau semua kelas aktif bila belum ada semester aktif). */
export function buildClassLookup(classes: readonly ImportClass[], activeAcademicYearId: string | null): ClassLookup {
  const lookup = new Map<string, ImportClass | "AMBIGUOUS">();
  for (const klass of classes) {
    if (!klass.isActive || (activeAcademicYearId !== null && klass.academicYearId !== activeAcademicYearId)) continue;
    const key = normalizeClassName(klass.name);
    lookup.set(key, lookup.has(key) ? "AMBIGUOUS" : klass);
  }
  return lookup;
}

const cellOf = (raw: RawImportRow, columns: ColumnMap, field: ImportField): unknown => {
  const index = columns[field];
  return index === undefined ? undefined : raw.values[index];
};

/** Baris yang seluruh kolom terpetakan kosong dilewati (kolom tak dikenal seperti "No" diabaikan). */
export function nonBlankRows(rows: readonly RawImportRow[], columns: ColumnMap): RawImportRow[] {
  return rows.filter((raw) => IMPORT_FIELDS.some((field) => cellText(cellOf(raw, columns, field)) !== null));
}

function matchClass(text: string | null, classes: ClassLookup): CellResult<ImportClass> {
  if (text === null) return { value: null };
  const found = classes.get(normalizeClassName(text));
  if (found === undefined) return { value: null, error: `Kelas "${text}" tidak ditemukan di antara kelas aktif tahun ajaran aktif.` };
  if (found === "AMBIGUOUS") return { value: null, error: `Nama kelas "${text}" ganda; ganti nama kelas agar unik.` };
  return { value: found };
}

type Parsed = Record<Exclude<ImportField, "className">, CellResult<unknown>> & { className: CellResult<ImportClass> };

const FIELD_TO_GAP: Readonly<Partial<Record<ImportField, GapField>>> = {
  nisn: "nisn", nis: "nis", name: "name", gender: "gender", birthPlace: "birthPlace", birthDate: "birthDate",
  address: "address", guardianName: "guardianName", guardianPhone: "guardianPhone", className: "currentClassId",
};

/** Opsi tahap parse: `today` = tanggal lokal sekolah (batas atas tanggal lahir). */
export interface ParseOptions {
  readonly today?: LocalDate;
}

function parseCells(raw: RawImportRow, columns: ColumnMap, classes: ClassLookup, options: ParseOptions): Parsed {
  const cell = (field: ImportField) => cellOf(raw, columns, field);
  return {
    nisn: parseNisnCell(cell("nisn")),
    nis: parseNisCell(cell("nis")),
    name: parseNameCell(cell("name")),
    gender: parseGenderCell(cell("gender")),
    birthPlace: parseTextCell(cell("birthPlace"), BIRTH_PLACE_MAX, "Tempat lahir"),
    birthDate: parseDateCell(cell("birthDate"), options.today),
    address: parseTextCell(cell("address"), ADDRESS_MAX, "Alamat"),
    guardianName: parseTextCell(cell("guardianName"), GUARDIAN_NAME_MAX, "Nama wali"),
    guardianPhone: parsePhoneCell(cell("guardianPhone")),
    className: matchClass(cellText(cell("className")), classes),
    sppAmount: parseSppCell(cell("sppAmount")),
  };
}

function parseImportRow(raw: RawImportRow, columns: ColumnMap, classes: ClassLookup, options: ParseOptions): ParsedImportRow {
  const cells = parseCells(raw, columns, classes, options);
  const entries = IMPORT_FIELDS.map((field) => [field, cells[field]] as const);
  return {
    row: raw.row,
    nisn: cells.nisn.value as string | null,
    nis: cells.nis.value as string | null,
    name: cells.name.value as string | null,
    gender: cells.gender.value as GenderValue | null,
    birthPlace: cells.birthPlace.value as string | null,
    birthDate: cells.birthDate.value as LocalDate | null,
    address: cells.address.value as string | null,
    guardianName: cells.guardianName.value as string | null,
    guardianPhone: cells.guardianPhone.value as string | null,
    className: cellText(cellOf(raw, columns, "className")),
    class: cells.className.value,
    sppAmount: cells.sppAmount.value as number | null,
    errors: entries.flatMap(([, result]) => (result.error ? [result.error] : [])),
    warnings: entries.flatMap(([, result]) => (result.warning ? [result.warning] : [])),
    invalidFields: entries.flatMap(([field, result]) => (result.error && FIELD_TO_GAP[field] ? [FIELD_TO_GAP[field]] : [])),
  };
}

export function parseImportRows(
  rows: readonly RawImportRow[],
  columns: ColumnMap,
  classes: ClassLookup,
  options: ParseOptions = {},
): ParsedImportRow[] {
  return nonBlankRows(rows, columns).map((raw) => parseImportRow(raw, columns, classes, options));
}

/** NISN & NIS unik (valid) untuk lookup DB batch. */
export function collectLookupKeys(rows: readonly ParsedImportRow[]): { nisns: string[]; nis: string[] } {
  const unique = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => v !== null))];
  return { nisns: unique(rows.map((r) => r.nisn)), nis: unique(rows.map((r) => r.nis)) };
}

function occurrences(rows: readonly ParsedImportRow[], keyOf: (r: ParsedImportRow) => string | null): Map<string, number[]> {
  // Akumulator lokal O(n): menyalin array per baris menjadi O(n²) untuk duplikat massal.
  const map = new Map<string, number[]>();
  for (const r of rows) {
    const key = keyOf(r);
    if (key === null) continue;
    const list = map.get(key);
    if (list === undefined) map.set(key, [r.row]);
    else list.push(r.row);
  }
  return map;
}

/** Nomor baris duplikat yang ditampilkan per pesan; sisanya diringkas "dan N lainnya". */
export const DUPLICATE_ROWS_SHOWN = 5;

export function duplicateRowsText(rows: readonly number[]): string {
  const shown = rows.slice(0, DUPLICATE_ROWS_SHOWN).join(", ");
  const more = rows.length - DUPLICATE_ROWS_SHOWN;
  return more > 0 ? `${shown} dan ${more} lainnya` : shown;
}

const REQUIRED_LABELS: ReadonlyArray<readonly [GapField, string]> = [
  ["nisn", "NISN"],
  ["nis", "NIS"],
  ["name", "Nama lengkap"],
  ["gender", "Jenis kelamin"],
];

function missingRequired(row: ParsedImportRow): GapField[] {
  return REQUIRED_LABELS.filter(([field]) => row[field as "nisn" | "nis" | "name" | "gender"] === null && !row.invalidFields.includes(field)).map(
    ([field]) => field,
  );
}

function activationInputOf(row: ParsedImportRow, ctx: ActivationContext): ActivationInput {
  return {
    name: row.name, nisn: row.nisn, nis: row.nis, gender: row.gender, birthPlace: row.birthPlace, birthDate: row.birthDate,
    address: row.address, guardianName: row.guardianName, guardianPhone: row.guardianPhone,
    classId: row.class?.id ?? null, class: row.class, schoolId: ctx.schoolId, schoolActive: ctx.schoolActive,
    timezone: ctx.timezone, activeAcademicYearId: ctx.activeAcademicYearId,
  };
}

interface CrossContext {
  readonly nisnRows: Map<string, number[]>;
  readonly nisRows: Map<string, number[]>;
  readonly lookups: ImportLookups;
  readonly activate: boolean;
  readonly activation: ActivationContext;
  readonly confirmRelease: boolean;
}

export const GRADUATE_RELEASE_WARNING = "NISN milik siswa lulus di sekolah lain; akun lama akan dilepas saat disimpan.";
export const GRADUATE_CONFIRM_WARNING =
  "NISN milik siswa lulus di sekolah lain. Kirim confirmReleaseGraduatedNisn=true untuk melepas akun lama; tanpa itu penyimpanan ditolak (409 NISN_HELD_BY_GRADUATE).";

function identityIssues(row: ParsedImportRow, ctx: CrossContext): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dupNisn = row.nisn === null ? [] : (ctx.nisnRows.get(row.nisn) ?? []);
  if (dupNisn.length > 1) errors.push(`NISN ganda di berkas (baris ${duplicateRowsText(dupNisn)}).`);
  const dupNis = row.nis === null ? [] : (ctx.nisRows.get(row.nis.toUpperCase()) ?? []);
  if (dupNis.length > 1) errors.push(`NIS ganda di berkas (baris ${duplicateRowsText(dupNis)}).`);
  if (row.nisn !== null && ctx.lookups.existingNisns.has(row.nisn)) errors.push("NISN sudah terdaftar di sekolah ini.");
  if (row.nis !== null && ctx.lookups.existingNisKeys.has(row.nis.toUpperCase())) errors.push("NIS sudah dipakai siswa lain di sekolah ini.");
  const holder = ctx.activate && row.nisn !== null ? ctx.lookups.holders.get(row.nisn) : undefined;
  if (holder === "GRADUATED") warnings.push(ctx.confirmRelease ? GRADUATE_RELEASE_WARNING : GRADUATE_CONFIRM_WARNING);
  else if (holder !== undefined) errors.push("NISN masih aktif di sekolah lain; sekolah asal harus menandai Pindah/Lulus.");
  return { errors, warnings };
}

function finalizeRow(row: ParsedImportRow, ctx: CrossContext): ParsedImportRow {
  const missing = missingRequired(row);
  const label = new Map(REQUIRED_LABELS);
  const requiredErrors = missing.map((field) => `${label.get(field)} wajib diisi.`);
  const skip = new Set<GapField>([...row.invalidFields, ...missing]);
  const gapErrors = ctx.activate
    ? getActivationGaps(activationInputOf(row, ctx.activation), ctx.activation.now).filter((g) => !skip.has(g.field)).map((g) => g.message)
    : [];
  const identity = identityIssues(row, ctx);
  return {
    ...row,
    errors: [...row.errors, ...requiredErrors, ...identity.errors, ...gapErrors],
    warnings: [...row.warnings, ...identity.warnings],
  };
}

export function validateImportRows(
  rows: readonly ParsedImportRow[],
  lookups: ImportLookups,
  options: { readonly activate: boolean; readonly activation: ActivationContext; readonly confirmRelease: boolean },
): ValidatedImport {
  const ctx: CrossContext = {
    nisnRows: occurrences(rows, (r) => r.nisn),
    nisRows: occurrences(rows, (r) => r.nis?.toUpperCase() ?? null),
    lookups,
    activate: options.activate,
    activation: options.activation,
    confirmRelease: options.confirmRelease,
  };
  const finalized = [...rows].sort((a, b) => a.row - b.row).map((row) => finalizeRow(row, ctx));
  const report: ImportReport = {
    totalRows: finalized.length,
    validRows: finalized.filter((r) => r.errors.length === 0).length,
    errorRows: finalized.filter((r) => r.errors.length > 0).length,
    warningRows: finalized.filter((r) => r.warnings.length > 0).length,
    rows: finalized.map((r) => ({ row: r.row, nisn: r.nisn, name: r.name, errors: r.errors, warnings: r.warnings })),
  };
  const graduateRows = options.activate ? finalized.filter((r) => r.nisn !== null && lookups.holders.get(r.nisn) === "GRADUATED").map((r) => r.row) : [];
  return { report, rows: finalized, graduateRows };
}
