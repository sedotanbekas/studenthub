import { addDays, diffDays, type LocalDate } from "@/lib/time/zone";

/**
 * Statistik absensi (murni, tanpa Prisma; desain 02 §3.10).
 * - Hadir = HADIR + TERLAMBAT; TERLAMBAT juga dilaporkan terpisah sebagai bagian dari hadir.
 * - Persentase bulanan/tren dihitung atas baris tercatat (student-day) pada hari yang SUDAH ditutup
 *   (tanggal <= closedThrough); rata-rata sekolah digabung (berbobot student-day), bukan rata-rata kelas.
 * - Kartu hari ini memakai jumlah siswa ACTIVE yang sudah aktif sebagai penyebut.
 */
export const ATTENDANCE_STATUSES = ["HADIR", "TERLAMBAT", "IZIN", "SAKIT", "ALPHA"] as const;
export type AttendanceStatusValue = (typeof ATTENDANCE_STATUSES)[number];

/** Batas titik/daftar peta per permintaan (meta truncated bila terlampaui). */
export const MAP_POINTS_MAX = 5000;
/** Rentang tanggal maksimum (inklusif) untuk anomali & tren kelas. */
export const ANALYTICS_MAX_RANGE_DAYS = 92;
export const STUDENT_TREND_MAX_MONTHS = 12;
export const STUDENT_TREND_DEFAULT_MONTHS = 6;
/** Entri audit & percobaan ditolak di detail catatan. */
export const DETAIL_AUDIT_LIMIT = 20;
export const DETAIL_REJECTIONS_LIMIT = 20;
export const NO_CLASS_LABEL = "Tanpa kelas";
export const DELETED_CLASS_LABEL = "(kelas dihapus)";

export interface StatusCounts {
  readonly hadir: number;
  readonly terlambat: number;
  readonly izin: number;
  readonly sakit: number;
  readonly alpha: number;
}

export const EMPTY_COUNTS: StatusCounts = Object.freeze({ hadir: 0, terlambat: 0, izin: 0, sakit: 0, alpha: 0 });

const KEY_OF: Readonly<Record<AttendanceStatusValue, keyof StatusCounts>> = {
  HADIR: "hadir",
  TERLAMBAT: "terlambat",
  IZIN: "izin",
  SAKIT: "sakit",
  ALPHA: "alpha",
};

export interface StatusCount {
  readonly status: AttendanceStatusValue;
  readonly count: number;
}

/** Satu desimal, setengah menjauhi nol; tidak pernah -0. */
export function round1(x: number): number {
  const rounded = (Math.sign(x) * Math.round(Math.abs(x) * 10)) / 10;
  return rounded === 0 ? 0 : rounded;
}

/** Persentase satu desimal; pembagi <= 0 -> null. */
export function pct(n: number, d: number): number | null {
  return d > 0 ? round1((n / d) * 100) : null;
}

/** Selisih dua persentase dalam poin persen (sekarang - sebelumnya). */
export function deltaPp(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : round1(current - previous);
}

export function addStatus(counts: StatusCounts, status: AttendanceStatusValue, n = 1): StatusCounts {
  const key = KEY_OF[status];
  return { ...counts, [key]: counts[key] + n };
}

export function countsFrom(groups: readonly StatusCount[]): StatusCounts {
  return groups.reduce((acc, group) => addStatus(acc, group.status, group.count), EMPTY_COUNTS);
}

export function sumCounts(a: StatusCounts, b: StatusCounts): StatusCounts {
  return { hadir: a.hadir + b.hadir, terlambat: a.terlambat + b.terlambat, izin: a.izin + b.izin, sakit: a.sakit + b.sakit, alpha: a.alpha + b.alpha };
}

export const recordedOf = (c: StatusCounts): number => c.hadir + c.terlambat + c.izin + c.sakit + c.alpha;
export const presentOf = (c: StatusCounts): number => c.hadir + c.terlambat;

export interface RateSummary {
  readonly recorded: number;
  readonly presentPct: number | null;
  readonly latePct: number | null;
  readonly izinPct: number | null;
  readonly sakitPct: number | null;
  readonly alphaPct: number | null;
  readonly counts: StatusCounts;
}

export function summarize(counts: StatusCounts): RateSummary {
  const recorded = recordedOf(counts);
  return {
    recorded,
    presentPct: pct(presentOf(counts), recorded),
    latePct: pct(counts.terlambat, recorded),
    izinPct: pct(counts.izin, recorded),
    sakitPct: pct(counts.sakit, recorded),
    alphaPct: pct(counts.alpha, recorded),
    counts,
  };
}

export interface TodayCard {
  readonly present: number;
  readonly late: number;
  readonly izin: number;
  readonly sakit: number;
  readonly alpha: number;
  readonly notYet: number;
  readonly presentPct: number | null;
}

/** Kartu "Kehadiran Hari Ini". Hari non-sekolah: tidak ada yang ditunggu (notYet 0) dan persen null. */
export function todayCard(input: { eligible: number; counts: StatusCounts; isSchoolDay: boolean }): TodayCard {
  const { eligible, counts, isSchoolDay } = input;
  const present = presentOf(counts);
  return {
    present,
    late: counts.terlambat,
    izin: counts.izin,
    sakit: counts.sakit,
    alpha: counts.alpha,
    notYet: isSchoolDay ? Math.max(0, eligible - recordedOf(counts)) : 0,
    presentPct: isSchoolDay ? pct(present, eligible) : null,
  };
}

// ----------------------------------------------------------------------------- bulan & periode

export const monthOf = (date: LocalDate): string => date.slice(0, 7);

/** "2026-01" + (-1) -> "2025-12". */
export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** n bulan terakhir, urut naik, diakhiri bulan `current`. */
export function recentMonths(current: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(current, i - (n - 1)));
}

export interface DatedStatus {
  readonly date: LocalDate;
  readonly status: AttendanceStatusValue;
}

export function aggregateByMonth(rows: readonly DatedStatus[], months: readonly string[]): Array<{ month: string; counts: StatusCounts }> {
  const byMonth = new Map<string, StatusCounts>(months.map((month) => [month, EMPTY_COUNTS]));
  for (const row of rows) {
    const current = byMonth.get(monthOf(row.date));
    if (current) byMonth.set(monthOf(row.date), addStatus(current, row.status));
  }
  return months.map((month) => ({ month, counts: byMonth.get(month) ?? EMPTY_COUNTS }));
}

/**
 * Rentang filter dengan default: to = hari ini, from = to - (defaultDays - 1). null bila from > to atau
 * lebih dari ANALYTICS_MAX_RANGE_DAYS hari (inklusif).
 */
export function resolveRange(
  from: LocalDate | undefined,
  to: LocalDate | undefined,
  today: LocalDate,
  defaultDays: number,
): { from: LocalDate; to: LocalDate } | null {
  const end = to ?? (from && from > today ? from : today);
  const start = from ?? addDays(end, -(defaultDays - 1));
  if (start > end || diffDays(end, start) + 1 > ANALYTICS_MAX_RANGE_DAYS) return null;
  return { from: start, to: end };
}

/** Potong periode di closedThrough; null bila belum ada hari tertutup di periode itu. */
export function cutPeriod(from: LocalDate, to: LocalDate, closed: LocalDate): { from: LocalDate; to: LocalDate } | null {
  const end = to < closed ? to : closed;
  return end < from ? null : { from, to: end };
}

// ----------------------------------------------------------------------------- per kelas

export interface ClassStatusCount extends StatusCount {
  readonly classId: string | null;
}

export interface ClassCount {
  readonly classId: string | null;
  readonly count: number;
}

const classLabel = (classId: string | null, names: ReadonlyMap<string, string>): string =>
  classId === null ? NO_CLASS_LABEL : (names.get(classId) ?? DELETED_CLASS_LABEL);

/** Urut nama kelas (numerik-sadar); baris tanpa kelas selalu terakhir. */
function byClassName<T extends { classId: string | null; className: string }>(a: T, b: T): number {
  if (a.classId === null || b.classId === null) return a.classId === null ? (b.classId === null ? 0 : 1) : -1;
  return a.className.localeCompare(b.className, "id", { numeric: true });
}

function countsByClass(groups: readonly ClassStatusCount[]): Map<string | null, StatusCounts> {
  const map = new Map<string | null, StatusCounts>();
  for (const group of groups) map.set(group.classId, addStatus(map.get(group.classId) ?? EMPTY_COUNTS, group.status, group.count));
  return map;
}

export interface RecapTotals {
  readonly eligible: number;
  readonly hadir: number;
  readonly terlambat: number;
  readonly izin: number;
  readonly sakit: number;
  readonly alpha: number;
  readonly notYet: number;
  readonly presentPct: number | null;
}

export interface RecapRow extends RecapTotals {
  readonly classId: string | null;
  readonly className: string;
}

function recapTotals(counts: StatusCounts, notYet: number, isSchoolDay: boolean): RecapTotals {
  const eligible = recordedOf(counts) + notYet;
  return { eligible, ...counts, notYet, presentPct: isSchoolDay ? pct(presentOf(counts), eligible) : null };
}

/**
 * Rekap harian per kelas: kelas baris tercatat = snapshot classId; siswa belum absen dihitung di kelas
 * saat ini. eligible = tercatat + belum absen.
 */
export function buildRecap(
  groups: readonly ClassStatusCount[],
  notYet: readonly ClassCount[],
  names: ReadonlyMap<string, string>,
  isSchoolDay: boolean,
): { classes: RecapRow[]; totals: RecapTotals } {
  const counts = countsByClass(groups);
  const waiting = new Map(notYet.map((n) => [n.classId, n.count] as const));
  const ids = [...new Set<string | null>([...counts.keys(), ...waiting.keys()])];
  const classes = ids
    .map((classId) => ({
      classId,
      className: classLabel(classId, names),
      ...recapTotals(counts.get(classId) ?? EMPTY_COUNTS, waiting.get(classId) ?? 0, isSchoolDay),
    }))
    .sort(byClassName);
  const all = [...counts.values()].reduce(sumCounts, EMPTY_COUNTS);
  const totalWaiting = notYet.reduce((sum, n) => sum + n.count, 0);
  return { classes, totals: recapTotals(all, totalWaiting, isSchoolDay) };
}

export interface ClassRates extends RateSummary {
  readonly classId: string | null;
  readonly className: string;
}

export function buildClassRates(groups: readonly ClassStatusCount[], names: ReadonlyMap<string, string>): ClassRates[] {
  return [...countsByClass(groups)]
    .map(([classId, counts]) => ({ classId, className: classLabel(classId, names), ...summarize(counts) }))
    .sort(byClassName);
}

// ----------------------------------------------------------------------------- tren harian

export interface DatedStatusCount extends StatusCount {
  readonly date: LocalDate;
}

export interface DailyRates extends RateSummary {
  readonly date: LocalDate;
  readonly isSchoolDay: boolean;
}

/** Satu entri per hari sekolah (kosong -> persen null) + tanggal lain yang punya baris, urut tanggal. */
export function buildDailyTrend(groups: readonly DatedStatusCount[], schoolDays: readonly LocalDate[]): DailyRates[] {
  const byDate = new Map<LocalDate, StatusCounts>(schoolDays.map((date) => [date, EMPTY_COUNTS]));
  for (const group of groups) byDate.set(group.date, addStatus(byDate.get(group.date) ?? EMPTY_COUNTS, group.status, group.count));
  const schoolDaySet = new Set(schoolDays);
  return [...byDate.keys()]
    .sort()
    .map((date) => ({ date, isSchoolDay: schoolDaySet.has(date), ...summarize(byDate.get(date) ?? EMPTY_COUNTS) }));
}
