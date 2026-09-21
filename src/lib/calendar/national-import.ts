import { z } from "zod";
import { parseLocalDate, type LocalDate } from "@/lib/time/zone";
import { validateHolidayRange } from "./rules";

/**
 * Impor libur nasional + cuti bersama (SKB 3 Menteri) dari prisma/data/national-holidays.json.
 * Murni: validasi berkas dan rencana upsert (cocok berdasarkan nama + tanggal mulai).
 */
export const NATIONAL_HOLIDAY_KINDS = ["LIBUR_NASIONAL", "CUTI_BERSAMA"] as const;

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

export interface NationalImportPlan {
  readonly create: readonly NationalHolidayEntry[];
  readonly update: ReadonlyArray<{ readonly id: string; readonly entry: NationalHolidayEntry; readonly beforeEndDate: LocalDate }>;
  readonly unchanged: number;
}

const keyOf = (item: { name: string; startDate: LocalDate }): string => `${item.name}|${item.startDate}`;

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

export function planNationalHolidayImport(
  entries: readonly NationalHolidayEntry[],
  existing: readonly ExistingNationalHoliday[],
): NationalImportPlan {
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
  return { create, update, unchanged };
}
