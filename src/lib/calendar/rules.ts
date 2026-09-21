import { addDays, daysInMonth, eachDate, parseLocalDate, type LocalDate } from "@/lib/time/zone";
import { inclusiveDays, type DateRange, type RuleViolation } from "./ranges";

/**
 * Aturan kalender sekolah (murni). Dipakai kalender siswa dan absensi (P2):
 * hari sekolah = bit hari ada di School.schoolDaysMask DAN tidak ada libur yang mencakup tanggal
 * DAN ada semester yang mencakup tanggal. Prioritas alasan: HOLIDAY > OUTSIDE_TERM > DAY_OFF.
 */
export type DayReason = "SCHOOL_DAY" | "DAY_OFF" | "HOLIDAY" | "OUTSIDE_TERM";
export const DAY_REASONS = ["SCHOOL_DAY", "DAY_OFF", "HOLIDAY", "OUTSIDE_TERM"] as const satisfies readonly DayReason[];

export interface CalendarHoliday extends DateRange {
  readonly name: string;
}

export interface CalendarContext {
  /** Bitmask: Sen=1 Sel=2 Rab=4 Kam=8 Jum=16 Sab=32 Min=64. */
  readonly schoolDaysMask: number;
  /** Libur sekolah + nasional yang relevan (rentang inklusif). */
  readonly holidays: readonly CalendarHoliday[];
  /** Semua semester sekolah yang relevan (rentang inklusif). */
  readonly terms: readonly DateRange[];
}

export interface DayCheck {
  readonly date: LocalDate;
  readonly isSchoolDay: boolean;
  readonly reason: DayReason;
  readonly holidayName: string | null;
}

export const MAX_HOLIDAY_DAYS = 60;
export const HOLIDAY_BACKDATE_DAYS = 7;

/** Bit hari untuk mask sekolah (Senin = 1 ... Minggu = 64). */
export function weekdayBitOf(date: LocalDate): number {
  if (parseLocalDate(date) === null) throw new RangeError(`Tanggal tidak valid: ${date}`);
  const weekdayIdx = (new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7;
  return 1 << weekdayIdx;
}

const covers = (range: DateRange, date: LocalDate): boolean => range.startDate <= date && date <= range.endDate;

function coveringHoliday(date: LocalDate, holidays: readonly CalendarHoliday[]): CalendarHoliday | null {
  let found: CalendarHoliday | null = null;
  for (const holiday of holidays) {
    if (!covers(holiday, date)) continue;
    const earlier = !found || holiday.startDate < found.startDate || (holiday.startDate === found.startDate && holiday.name < found.name);
    if (earlier) found = holiday;
  }
  return found;
}

export function checkSchoolDay(date: LocalDate, ctx: CalendarContext): DayCheck {
  const bit = weekdayBitOf(date);
  const holiday = coveringHoliday(date, ctx.holidays);
  if (holiday) return { date, isSchoolDay: false, reason: "HOLIDAY", holidayName: holiday.name };
  if (!ctx.terms.some((term) => covers(term, date))) return { date, isSchoolDay: false, reason: "OUTSIDE_TERM", holidayName: null };
  if ((ctx.schoolDaysMask & bit) === 0) return { date, isSchoolDay: false, reason: "DAY_OFF", holidayName: null };
  return { date, isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null };
}

/** Status setiap tanggal dalam rentang inklusif (kosong bila rentang terbalik). */
export function describeDays(from: LocalDate, to: LocalDate, ctx: CalendarContext): DayCheck[] {
  return eachDate(from, to).map((date) => checkSchoolDay(date, ctx));
}

/** Hanya tanggal hari sekolah dalam rentang inklusif. */
export function listSchoolDays(from: LocalDate, to: LocalDate, ctx: CalendarContext): LocalDate[] {
  return describeDays(from, to, ctx)
    .filter((day) => day.isSchoolDay)
    .map((day) => day.date);
}

export function validateHolidayRange(range: DateRange): RuleViolation | null {
  if (range.startDate > range.endDate) {
    return { code: "INVALID_DATE_RANGE", message: "Tanggal mulai tidak boleh setelah tanggal selesai." };
  }
  if (inclusiveDays(range) > MAX_HOLIDAY_DAYS) {
    return { code: "HOLIDAY_TOO_LONG", message: `Rentang libur maksimal ${MAX_HOLIDAY_DAYS} hari.` };
  }
  return null;
}

/** Tanggal mulai paling awal yang boleh disentuh admin sekolah (hari ini lokal - 7). */
export const backdateLimitDate = (today: LocalDate): LocalDate => addDays(today, -HOLIDAY_BACKDATE_DAYS);

export const isWithinBackdateLimit = (startDate: LocalDate, today: LocalDate): boolean => startDate >= backdateLimitDate(today);

/** Periode filter daftar libur: satu tahun penuh, atau satu bulan bila month diisi. */
export function holidayPeriod(year: number, month: number | undefined): { from: LocalDate; to: LocalDate } {
  if (month === undefined) return { from: `${year}-01-01`, to: `${year}-12-31` };
  const mm = String(month).padStart(2, "0");
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(daysInMonth(year, month)).padStart(2, "0")}` };
}

/** "2026-09-21" -> "2026-09". */
export const monthKeyOf = (date: LocalDate): string => date.slice(0, 7);
