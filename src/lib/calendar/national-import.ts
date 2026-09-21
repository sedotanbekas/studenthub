import { z } from "zod";
import { parseLocalDate, type LocalDate } from "@/lib/time/zone";
import { validateHolidayRange } from "./rules";

/**
 * Impor libur nasional + cuti bersama (SKB 3 Menteri) dari prisma/data/national-holidays.json.
 * Murni: validasi berkas, argumen CLI, dan rencana impor.
 *
 * Rencana default: per TAHUN (tahun tanggal mulai). Tahun yang sudah punya minimal satu libur nasional
 * dilewati seluruhnya, agar libur yang sudah diganti nama/dihapus super admin tidak dibuat ulang (tanpa
 * kolom penanda sumber di skema). `force` = perilaku lama: cocok per nama + tanggal mulai di semua tahun.
 */
export const NATIONAL_HOLIDAY_KINDS = ["LIBUR_NASIONAL", "CUTI_BERSAMA"] as const;

/** Keterangan untuk tahun yang dilewati impor default. */
export const YEAR_ALREADY_IMPORTED_NOTE = "tahun sudah diimpor, dilewati";
export const FORCE_FLAG = "--force";

const localDate = z.string().refine((v) => parseLocalDate(v) !== null, "Tanggal harus YYYY-MM-DD yang valid.");

const entrySchema = z.strictObject({
  name: z.string().trim().min(3).max(150),
  startDate: localDate,
  endDate: localDate,
  kind: z.enum(NATIONAL_HOLIDAY_KINDS),
  source: z.url({ protocol: /^https$/ }),
});

export type NationalHolidayEntry = z.output<typeof entrySchema>;

export interface ExistingNationalHoliday {
  readonly id: string;
  readonly name: string;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

export interface SkippedImportYear {
  readonly year: string;
  /** Jumlah entri berkas pada tahun itu yang tidak diproses. */
  readonly entries: number;
}

export interface NationalImportOptions {
  /** true = cocok per nama + tanggal mulai di semua tahun (dapat membuat ulang libur yang dihapus/diganti nama). */
  readonly force?: boolean;
}

export interface NationalImportPlan {
  readonly create: readonly NationalHolidayEntry[];
  readonly update: ReadonlyArray<{ readonly id: string; readonly entry: NationalHolidayEntry; readonly beforeEndDate: LocalDate }>;
  readonly unchanged: number;
  readonly skippedYears: readonly SkippedImportYear[];
}

export interface NationalImportArgs {
  readonly force: boolean;
  /** null = berkas default. */
  readonly file: string | null;
}

const keyOf = (item: { name: string; startDate: LocalDate }): string => `${item.name}|${item.startDate}`;

/** Tahun (YYYY) sebuah entri/baris = tahun tanggal mulainya. */
export const yearOf = (item: { startDate: LocalDate }): string => item.startDate.slice(0, 4);

/** Tahun-tahun yang dicakup entri, terurut naik tanpa duplikat. */
export const importYearsOf = (entries: readonly NationalHolidayEntry[]): string[] => [...new Set(entries.map(yearOf))].sort();

/** Validasi isi berkas; melempar Error dengan pesan jelas bila ada entri yang tidak sah. */
export function parseNationalHolidayFile(raw: unknown): NationalHolidayEntry[] {
  const entries = z.array(entrySchema).parse(raw);
  const seen = new Set<string>();
  for (const e of entries) {
    const violation = validateHolidayRange(e);
    if (violation) throw new Error(`${e.name} (${e.startDate}): ${violation.message}`);
    if (seen.has(keyOf(e))) throw new Error(`Entri duplikat: ${e.name} (${e.startDate})`);
    seen.add(keyOf(e));
  }
  return entries;
}

/** Argumen CLI: `[--force] [berkas.json]` (urutan bebas; `--` pemisah pnpm diabaikan). */
export function parseNationalImportArgs(argv: readonly string[]): NationalImportArgs {
  const args = argv.filter((arg) => arg !== "--");
  const flags = args.filter((arg) => arg.startsWith("--"));
  const unknown = flags.filter((flag) => flag !== FORCE_FLAG);
  if (unknown.length > 0) throw new Error(`Opsi tidak dikenal: ${unknown.join(", ")} (yang tersedia hanya ${FORCE_FLAG}).`);
  const files = args.filter((arg) => !arg.startsWith("--"));
  if (files.length > 1) throw new Error("Hanya satu berkas JSON yang dapat diimpor sekali jalan.");
  return { force: flags.length > 0, file: files[0] ?? null };
}

/** Perilaku --force: entri tanpa pasangan dibuat, pasangan dengan endDate berbeda diperbarui. */
function planByKey(entries: readonly NationalHolidayEntry[], existing: readonly ExistingNationalHoliday[]): NationalImportPlan {
  const byKey = new Map(existing.map((row) => [keyOf(row), row]));
  const create: NationalHolidayEntry[] = [];
  const update: Array<{ id: string; entry: NationalHolidayEntry; beforeEndDate: LocalDate }> = [];
  let unchanged = 0;
  for (const e of entries) {
    const row = byKey.get(keyOf(e));
    if (!row) create.push(e);
    else if (row.endDate !== e.endDate) update.push({ id: row.id, entry: e, beforeEndDate: row.endDate });
    else unchanged += 1;
  }
  return { create, update, unchanged, skippedYears: [] };
}

function countByYear(entries: readonly NationalHolidayEntry[]): SkippedImportYear[] {
  return importYearsOf(entries).map((year) => ({ year, entries: entries.filter((e) => yearOf(e) === year).length }));
}

/**
 * `existing` = SEMUA libur nasional pada tahun-tahun entri. Default: tahun yang sudah terisi dilewati,
 * tahun kosong dibuat seluruhnya. `force`: cocok per nama + tanggal mulai (perilaku lama).
 */
export function planNationalHolidayImport(
  entries: readonly NationalHolidayEntry[],
  existing: readonly ExistingNationalHoliday[],
  options: NationalImportOptions = {},
): NationalImportPlan {
  if (options.force) return planByKey(entries, existing);
  const importedYears = new Set(existing.map(yearOf));
  const skipped = entries.filter((e) => importedYears.has(yearOf(e)));
  const create = entries.filter((e) => !importedYears.has(yearOf(e)));
  return { create, update: [], unchanged: 0, skippedYears: countByYear(skipped) };
}
