import type { ClassAnalyticsDto, SchoolTrendDto, SummaryAnalyticsDto } from "@/lib/attendance/monitor-schemas";
import { ANALYTICS_MAX_RANGE_DAYS, EMPTY_COUNTS, deltaPp, shiftMonth, sumCounts, summarize, type StatusCounts } from "@/lib/attendance/attendance-stats";
import { addDays, diffDays, eachDate, localParts, monthRange, parseLocalDate } from "@/lib/time/zone";
import { monthOf, trendRange } from "./school-chart-rules";

/**
 * Data contoh analitik absensi admin sekolah (tren harian sekolah, per kelas, ringkasan bulan) untuk
 * mode demo. Bentuk persis DTO /school/attendance/analytics/*; `undefined` bila jalur bukan miliknya.
 * Sekolah demo: 1.284 siswa (sama dengan demoSummary), Senin–Jumat; hadir ~93–96% dengan kenaikan
 * tipis dalam 60 hari terakhir dan Senin sedikit lebih rendah. Angka deterministik per tanggal.
 */

const STUDENTS = 1284;
const DEFAULT_TREND_DAYS = 30;
/** Rentang (hari) kenaikan tipis tingkat hadir menuju hari ini. */
const TREND_SPAN_DAYS = 60;
const TREND_PATH = "/school/attendance/analytics/trend";
const CLASSES_PATH = "/school/attendance/analytics/classes";
const SUMMARY_PATH = "/school/attendance/analytics/summary";

interface Cohort { readonly size: number; readonly offsetPp: number; readonly salt: number }
const SCHOOL: Cohort = { size: STUDENTS, offsetPp: 0, salt: 0 };
const CLASSES: ReadonlyArray<Cohort & { readonly id: string; readonly name: string }> = [
  { id: "c-x-ipa-1", name: "X IPA 1", size: 36, offsetPp: 1.4, salt: 11 },
  { id: "c-x-ipa-2", name: "X IPA 2", size: 35, offsetPp: -0.8, salt: 12 },
  { id: "c-x-ips-1", name: "X IPS 1", size: 34, offsetPp: -2.1, salt: 13 },
  { id: "c-xi-ipa-1", name: "XI IPA 1", size: 36, offsetPp: 0.6, salt: 14 },
  { id: "c-xi-ips-2", name: "XI IPS 2", size: 33, offsetPp: -7.4, salt: 15 },
  { id: "c-xii-ipa-1", name: "XII IPA 1", size: 35, offsetPp: 2.3, salt: 16 },
  { id: "c-xii-ipa-2", name: "XII IPA 2", size: 34, offsetPp: 0.2, salt: 17 },
  { id: "c-xii-ips-1", name: "XII IPS 1", size: 32, offsetPp: -3.3, salt: 18 },
];

/** Hari ini (WIB) — sekolah demo berzona WIB. */
export const demoToday = (now: Date = new Date()): string => localParts(now, "WIB").ymd;
const closedThroughOf = (today: string): string => addDays(today, -1);
const isWeekend = (date: string): boolean => [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
const isMonday = (date: string): boolean => new Date(`${date}T00:00:00Z`).getUTCDay() === 1;

/** Pseudo-acak deterministik 0..1 per (tanggal, salt) — FNV-1a + pengaduk. */
function noise(date: string, salt: number): number {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < date.length; i++) h = Math.imul(h ^ date.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Catatan satu hari sekolah untuk satu kelompok siswa (semua tercatat karena hari sudah ditutup). */
function dayCounts(date: string, today: string, cohort: Cohort): StatusCounts {
  const age = Math.min(TREND_SPAN_DAYS, Math.max(0, diffDays(today, date)));
  const trend = 2 * (1 - age / TREND_SPAN_DAYS);
  const rawPct = 93.4 + trend + (noise(date, cohort.salt + 1) - 0.5) * 1.4 + (isMonday(date) ? -0.6 : 0) + cohort.offsetPp;
  const present = Math.round((cohort.size * Math.min(99.5, rawPct)) / 100);
  const terlambat = Math.min(present, Math.round((cohort.size * (1.2 + noise(date, cohort.salt + 2) * 1.7)) / 100));
  const absent = absentSplit(date, cohort.salt, cohort.size - present);
  return { hadir: present - terlambat, terlambat, ...absent };
}

/** Siswa tidak hadir dibagi per orang (bukan pembulatan proporsi): ~40% izin, ~33% sakit, sisanya alpa. */
function absentSplit(date: string, salt: number, absent: number): Pick<StatusCounts, "izin" | "sakit" | "alpha"> {
  const split = { izin: 0, sakit: 0, alpha: 0 };
  for (let i = 0; i < absent; i++) {
    const u = noise(date, salt * 1000 + 10 + i);
    if (u < 0.4) split.izin += 1;
    else if (u < 0.73) split.sakit += 1;
    else split.alpha += 1;
  }
  return split;
}

/** Jumlah catatan hari sekolah yang sudah ditutup dalam satu bulan. */
function monthCounts(month: string, today: string, cohort: Cohort): { counts: StatusCounts; schoolDays: number } {
  const range = monthRange(month);
  const cut = closedThroughOf(today);
  if (!range || range.from > cut) return { counts: EMPTY_COUNTS, schoolDays: 0 };
  const days = eachDate(range.from, range.to < cut ? range.to : cut).filter(date => !isWeekend(date));
  return { counts: days.map(date => dayCounts(date, today, cohort)).reduce(sumCounts, EMPTY_COUNTS), schoolDays: days.length };
}

/** Tren harian sekolah from..to, dipotong di closedThrough (kemarin); akhir pekan = bukan hari sekolah. */
export function demoSchoolTrend(from: string, to: string, today: string = demoToday()): SchoolTrendDto {
  const closedThrough = closedThroughOf(today);
  const last = to < closedThrough ? to : closedThrough;
  const days = from <= last
    ? eachDate(from, last).map(date => (isWeekend(date)
      ? { date, isSchoolDay: false, ...summarize(EMPTY_COUNTS) }
      : { date, isSchoolDay: true, ...summarize(dayCounts(date, today, SCHOOL)) }))
    : [];
  return { from, to, closedThrough, days };
}

/** Kehadiran per kelas satu bulan (hanya hari yang sudah ditutup); sekolah = seluruh 1.284 siswa. */
export function demoClassAnalytics(month: string, today: string = demoToday()): ClassAnalyticsDto {
  const range = monthRange(month) ?? { from: `${month}-01`, to: `${month}-01` };
  const closedThrough = closedThroughOf(today);
  const school = monthCounts(month, today, SCHOOL);
  const classes = school.schoolDays === 0 ? [] : CLASSES.map(c => ({ classId: c.id, className: c.name, ...summarize(monthCounts(month, today, c).counts) }));
  return {
    period: { month, from: range.from, to: range.to, closedThrough, isPartial: range.to > closedThrough, unclosedDates: [] },
    school: summarize(school.counts),
    classes,
  };
}

/** Ringkasan bulan + selisih poin persen terhadap bulan sebelumnya. */
export function demoSummaryAnalytics(month: string, today: string = demoToday()): SummaryAnalyticsDto {
  const rates = summarize(monthCounts(month, today, SCHOOL).counts);
  const prevMonth = shiftMonth(month, -1);
  const prevPresentPct = summarize(monthCounts(prevMonth, today, SCHOOL).counts).presentPct;
  const range = monthRange(month);
  const closedThrough = closedThroughOf(today);
  return { ...rates, month, closedThrough, isPartial: (range?.to ?? month) > closedThrough, prevMonth, prevPresentPct, deltaPp: deltaPp(rates.presentPct, prevPresentPct) };
}

function trendFromQuery(params: URLSearchParams, today: string): SchoolTrendDto {
  const from = parseLocalDate(params.get("from") ?? "");
  const to = parseLocalDate(params.get("to") ?? "");
  if (from && to && from <= to && diffDays(to, from) < ANALYTICS_MAX_RANGE_DAYS) return demoSchoolTrend(from, to, today);
  const range = trendRange(DEFAULT_TREND_DAYS, today);
  return demoSchoolTrend(range.from, range.to, today);
}

export function demoAnalyticsRows(path: string, today: string = demoToday()): unknown {
  const [base = "", query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  if (base === TREND_PATH) return trendFromQuery(params, today);
  if (base !== CLASSES_PATH && base !== SUMMARY_PATH) return undefined;
  const asked = params.get("month") ?? "";
  const month = monthRange(asked) ? asked : monthOf(today);
  return base === CLASSES_PATH ? demoClassAnalytics(month, today) : demoSummaryAnalytics(month, today);
}
