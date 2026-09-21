/**
 * Waktu lokal sekolah dengan offset tetap (Indonesia tanpa DST): WIB +7, WITA +8, WIT +9.
 * Murni: tidak bergantung pada process.env.TZ. LocalDate = "YYYY-MM-DD".
 * Kolom @db.Date disimpan sebagai UTC-midnight dari tanggal lokal.
 */
export type SchoolTz = "WIB" | "WITA" | "WIT";
export type LocalDate = string;

export const TZ_OFFSET_MINUTES: Readonly<Record<SchoolTz, number>> = { WIB: 420, WITA: 480, WIT: 540 };
export const TZ_IANA: Readonly<Record<SchoolTz, string>> = { WIB: "Asia/Jakarta", WITA: "Asia/Makassar", WIT: "Asia/Jayapura" };

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

export type LocalParts = {
  ymd: LocalDate;
  minuteOfDay: number;
  /** Senin = 0 ... Minggu = 6. */
  weekdayIdx: number;
  /** Bit hari untuk School.schoolDaysMask (Senin = 1 ... Minggu = 64). */
  weekdayBit: number;
  year: number;
  month: number;
};

export function localParts(instant: Date, tz: SchoolTz): LocalParts {
  const shifted = new Date(instant.getTime() + TZ_OFFSET_MINUTES[tz] * MS_PER_MINUTE);
  const weekdayIdx = (shifted.getUTCDay() + 6) % 7;
  return {
    ymd: shifted.toISOString().slice(0, 10),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    weekdayIdx,
    weekdayBit: 1 << weekdayIdx,
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}

export const wibDate = (instant: Date): LocalDate => localParts(instant, "WIB").ymd;
export const localYear = (instant: Date, tz: SchoolTz): number => localParts(instant, tz).year;

/** Validasi & normalisasi tanggal kalender nyata (menolak 2026-02-30). */
export function parseLocalDate(value: string): LocalDate | null {
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  return valid ? value : null;
}

function requireDate(value: LocalDate): number {
  if (parseLocalDate(value) === null) throw new RangeError(`Tanggal tidak valid: ${value}`);
  return Date.parse(`${value}T00:00:00.000Z`);
}

export const toDbDate = (value: LocalDate): Date => new Date(requireDate(value));
export const fromDbDate = (value: Date): LocalDate => value.toISOString().slice(0, 10);

export const addDays = (value: LocalDate, days: number): LocalDate =>
  new Date(requireDate(value) + days * MS_PER_DAY).toISOString().slice(0, 10);

export const diffDays = (later: LocalDate, earlier: LocalDate): number =>
  Math.round((requireDate(later) - requireDate(earlier)) / MS_PER_DAY);

export function eachDate(from: LocalDate, to: LocalDate): LocalDate[] {
  const count = diffDays(to, from);
  return count < 0 ? [] : Array.from({ length: count + 1 }, (_, i) => addDays(from, i));
}

/** Instant UTC untuk menit tertentu pada tanggal lokal sekolah. */
export function instantAtLocal(value: LocalDate, minuteOfDay: number, tz: SchoolTz): Date {
  return new Date(requireDate(value) + (minuteOfDay - TZ_OFFSET_MINUTES[tz]) * MS_PER_MINUTE);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Rentang tahun yang diterima monthRange (tahun < 1900 menghasilkan tanggal tak valid -> dulu 500). */
export const MONTH_RANGE_MIN_YEAR = 1900;
export const MONTH_RANGE_MAX_YEAR = 9999;

/** "2026-09" -> { from: "2026-09-01", to: "2026-09-30" }; null bila format salah atau tahun di luar 1900..9999. */
export function monthRange(value: string): { from: LocalDate; to: LocalDate } | null {
  const match = MONTH_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < MONTH_RANGE_MIN_YEAR || year > MONTH_RANGE_MAX_YEAR) return null;
  if (month < 1 || month > 12) return null;
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}` };
}

/** 435 -> "07:15". */
export function formatMinute(minuteOfDay: number): string {
  const h = Math.floor(minuteOfDay / 60);
  const m = minuteOfDay % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
