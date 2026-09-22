import { addDays, diffDays, eachDate, parseLocalDate, type LocalDate } from "@/lib/time/zone";
import { ANALYTICS_MAX_RANGE_DAYS, ANALYTICS_PRESETS, type ANALYTICS_SORTS } from "./constants";
import { adViolation, type AdViolation } from "./errors";

/** Aturan murni analitik sponsor: periode (hari WIB), CTR, % perubahan, deret harian, pangsa, urutan tabel. */

export interface PeriodQuery {
  readonly preset?: keyof typeof ANALYTICS_PRESETS | undefined;
  readonly from?: LocalDate | undefined;
  readonly to?: LocalDate | undefined;
}

export interface Period {
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly prevFrom: LocalDate;
  readonly prevTo: LocalDate;
  readonly days: number;
}

export type PeriodResult = { readonly ok: true; readonly period: Period } | { readonly ok: false; readonly violation: AdViolation };

const invalid = (message: string): PeriodResult => ({ ok: false, violation: adViolation("ANALYTICS_RANGE_INVALID", message) });

function withPrevious(from: LocalDate, to: LocalDate): Period {
  const days = diffDays(to, from) + 1;
  return { from, to, prevFrom: addDays(from, -days), prevTo: addDays(from, -1), days };
}

/** preset (default 7d, termasuk hari ini) ATAU from+to kustom (<= 92 hari, to <= hari ini). */
export function resolvePeriod(q: PeriodQuery, today: LocalDate): PeriodResult {
  const custom = q.from !== undefined || q.to !== undefined;
  if (custom && q.preset !== undefined) return invalid("Pilih preset ATAU rentang from/to, bukan keduanya.");
  if (!custom) return { ok: true, period: withPrevious(addDays(today, -(ANALYTICS_PRESETS[q.preset ?? "7d"] - 1)), today) };
  if (q.from === undefined || q.to === undefined) return invalid("Rentang kustom wajib mengisi from dan to.");
  if (parseLocalDate(q.from) === null || parseLocalDate(q.to) === null) return invalid("Tanggal harus berformat YYYY-MM-DD.");
  if (q.from > q.to) return invalid("Tanggal from harus sebelum atau sama dengan to.");
  if (q.to > today) return invalid("Tanggal to tidak boleh melewati hari ini (WIB).");
  if (diffDays(q.to, q.from) + 1 > ANALYTICS_MAX_RANGE_DAYS) return invalid(`Rentang maksimal ${ANALYTICS_MAX_RANGE_DAYS} hari.`);
  return { ok: true, period: withPrevious(q.from, q.to) };
}

const round = (value: number, decimals: number): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** CTR % dua desimal; null tanpa impresi. Bisa > 100 (impresi didedupe 30 menit, klik tidak). */
export const ctr = (clicks: number, impressions: number): number | null => (impressions > 0 ? round((clicks / impressions) * 100, 2) : null);

/** % perubahan satu desimal: 0/0 -> 0; sebelumnya 0 (atau nilai tak terdefinisi) -> null. */
export function changePct(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return round(((current - previous) / previous) * 100, 1);
}

export interface DailyRow {
  readonly date: LocalDate;
  readonly impressions: number;
  readonly clicks: number;
  readonly uniqueClicks: number;
  readonly chargedClicks: number;
  readonly spend: number;
}

export function fillDailySeries(rows: readonly DailyRow[], from: LocalDate, to: LocalDate): DailyRow[] {
  const byDate = new Map(rows.map((row) => [row.date, row]));
  return eachDate(from, to).map((date) => byDate.get(date) ?? { date, impressions: 0, clicks: 0, uniqueClicks: 0, chargedClicks: 0, spend: 0 });
}

export interface ShareInput {
  readonly key: string;
  readonly clicks: number;
}

const SHARE_UNITS = 1_000;

/** Pangsa % satu desimal dengan metode sisa terbesar (jumlah selalu tepat 100 bila ada klik). */
export function shareBreakdown<T extends ShareInput>(rows: readonly T[]): Array<T & { sharePct: number }> {
  const total = rows.reduce((sum, row) => sum + row.clicks, 0);
  if (total === 0) return rows.map((row) => ({ ...row, sharePct: 0 }));
  const exact = rows.map((row) => (row.clicks * SHARE_UNITS) / total);
  const units = exact.map(Math.floor);
  let left = SHARE_UNITS - units.reduce((sum, u) => sum + u, 0);
  const order = exact.map((value, i) => ({ i, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    units[i] = (units[i] ?? 0) + 1;
    left -= 1;
  }
  return rows.map((row, i) => ({ ...row, sharePct: (units[i] ?? 0) / 10 }));
}

export type AdSortKey = (typeof ANALYTICS_SORTS)[number];

export interface SortableAdRow {
  readonly title: string;
  readonly impressions: number;
  readonly clicks: number;
  readonly ctr: number | null;
  readonly spend: number;
}

/** Urut menurun menurut kunci; seri -> klik, impresi (menurun), lalu judul (naik). */
export function sortAdRows<T extends SortableAdRow>(rows: readonly T[], key: AdSortKey): T[] {
  const value = (row: T): number => (key === "ctr" ? (row.ctr ?? -1) : row[key]);
  return [...rows].sort(
    (a, b) => value(b) - value(a) || b.clicks - a.clicks || b.impressions - a.impressions || a.title.localeCompare(b.title),
  );
}
