import { addDays, diffDays, type LocalDate } from "@/lib/time/zone";

/**
 * Utilitas rentang tanggal lokal inklusif (murni, tanpa Prisma). Dipakai kalender, akademik,
 * dan absensi. Perbandingan string "YYYY-MM-DD" setara urutan kronologis.
 */
export interface DateRange {
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

/** Pelanggaran aturan bisnis murni; service memetakannya ke AppError 409/422. */
export interface RuleViolation {
  readonly code: string;
  readonly message: string;
}

/** Jumlah hari inklusif (1 untuk rentang satu hari; 0 bila terbalik). */
export function inclusiveDays(range: DateRange): number {
  return Math.max(0, diffDays(range.endDate, range.startDate) + 1);
}

export function rangesOverlap(a: DateRange, b: DateRange): boolean {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

export function rangeContains(outer: DateRange, inner: DateRange): boolean {
  return outer.startDate <= inner.startDate && inner.endDate <= outer.endDate;
}

export function unionRange(a: DateRange, b: DateRange): DateRange {
  return {
    startDate: a.startDate < b.startDate ? a.startDate : b.startDate,
    endDate: a.endDate > b.endDate ? a.endDate : b.endDate,
  };
}

/** Bagian rentang lama yang tidak lagi tercakup rentang baru (maks. dua potong). */
export function removedRanges(before: DateRange, after: DateRange): DateRange[] {
  if (!rangesOverlap(before, after)) return [before];
  const removed: DateRange[] = [];
  if (after.startDate > before.startDate) {
    removed.push({ startDate: before.startDate, endDate: addDays(after.startDate, -1) });
  }
  if (after.endDate < before.endDate) {
    removed.push({ startDate: addDays(after.endDate, 1), endDate: before.endDate });
  }
  return removed;
}
