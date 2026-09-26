import type { ClassAnalyticsDto, SchoolTrendDto, SummaryAnalyticsDto } from "@/lib/attendance/monitor-schemas";
import { addDays, eachDate, localParts, parseLocalDate, type SchoolTz } from "@/lib/time/zone";
import { shortDate } from "./chart-rules";

/**
 * Aturan murni grafik beranda admin sekolah (tanpa DOM): rentang tren dari "hari ini" zona sekolah,
 * pemetaan hari ke seri kolom bertumpuk, urutan & penanda kelas yang perlu perhatian, teks ringkas,
 * dan penjaga bentuk data API (data rusak -> galat per panel, bukan crash).
 */

/** Kelas dengan persen hadir di bawah batas ini ditandai "perlu perhatian". */
export const ATTENTION_PCT = 90;
/** Periode tren yang bisa dipilih (hari). */
export const TREND_PERIODS = [14, 30] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];

type Counts = SchoolTrendDto["days"][number]["counts"];
type CountKey = keyof Counts;

const ZONES: readonly string[] = ["WIB", "WITA", "WIT"];
const oneDecimal = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("id-ID");
const MONTH_NAMES = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

/** Tanggal lokal hari ini di zona sekolah; zona yang tidak dikenal jatuh ke WIB. */
export function schoolToday(timezone: string | undefined, now: Date = new Date()): string {
  const zone = (timezone && ZONES.includes(timezone) ? timezone : "WIB") as SchoolTz;
  return localParts(now, zone).ymd;
}

/** `days` hari terakhir yang sudah lewat: kemarin mundur `days` hari (hari ini belum ditutup). */
export function trendRange(days: number, today: string): { from: string; to: string } {
  return { from: addDays(today, -days), to: addDays(today, -1) };
}

export { monthOf } from "@/lib/attendance/attendance-stats";

/** "2026-08" -> "Agustus"; bulan tidak valid dikembalikan apa adanya. */
export function monthName(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return MONTH_NAMES[index] ?? month;
}

/** Persen satu desimal gaya Indonesia ("93,4%"); null -> "—". */
export function pctText(value: number | null): string {
  return value === null ? "—" : `${oneDecimal.format(value)}%`;
}

/** Catatan kartu "Kehadiran bulan ini": nilai bulan lalu sebagai pembanding + batas data tertutup. */
export function monthTileNote(s: { closedThrough: string; presentPct: number | null; prevMonth: string; prevPresentPct: number | null }): string {
  if (s.presentPct === null) return "Belum ada hari sekolah yang ditutup bulan ini";
  const through = `s.d. ${shortDate(s.closedThrough)}`;
  return s.prevPresentPct === null ? `Data ${through}` : `${monthName(s.prevMonth)} ${pctText(s.prevPresentPct)} · data ${through}`;
}

/** Komposisi bulan selain hadir tepat waktu (terlambat, izin, sakit, alpa) untuk kartu bulan ini. */
export function monthMix(rate: { latePct: number | null; izinPct: number | null; sakitPct: number | null; alphaPct: number | null }): Array<{ key: string; label: string; text: string; color: string }> {
  const pcts: Record<string, number | null> = { terlambat: rate.latePct, izin: rate.izinPct, sakit: rate.sakitPct, alpha: rate.alphaPct };
  return STATUS_SERIES.filter(s => s.key !== "hadir").map(s => ({ key: s.key, label: s.label, text: pctText(pcts[s.key] ?? 0), color: s.color }));
}

// ----------------------------------------------------------------------------- tren harian

export interface TrendDay {
  readonly date: string;
  readonly isSchoolDay: boolean;
  /** false = setelah closedThrough (belum ditutup, belum ada data final). */
  readonly isClosed: boolean;
  readonly presentPct: number | null;
  readonly counts: Counts | null;
}

/** Urutan tumpukan = urutan status di legenda (bawah -> atas). */
export const STATUS_SERIES: ReadonlyArray<{ readonly key: CountKey; readonly label: string; readonly color: string }> = [
  { key: "hadir", label: "Hadir", color: "var(--att-hadir)" },
  { key: "terlambat", label: "Terlambat", color: "var(--att-terlambat)" },
  { key: "izin", label: "Izin", color: "var(--att-izin)" },
  { key: "sakit", label: "Sakit", color: "var(--att-sakit)" },
  { key: "alpha", label: "Alpa", color: "var(--att-alpha)" },
];

/**
 * Sumbu tanggal penuh from..to. Server hanya mengirim hari sekolah (dan hari lain yang bercatatan),
 * jadi tanggal yang tidak dikirim = bukan hari sekolah; tanggal setelah closedThrough = belum ditutup.
 */
export function trendDays(dto: SchoolTrendDto): TrendDay[] {
  const byDate = new Map(dto.days.map(day => [day.date, day]));
  return eachDate(dto.from, dto.to).map(date => {
    const isClosed = date <= dto.closedThrough;
    const day = isClosed ? byDate.get(date) : undefined;
    if (!day) return { date, isSchoolDay: false, isClosed, presentPct: null, counts: null };
    return { date, isSchoolDay: day.isSchoolDay, isClosed, presentPct: day.presentPct, counts: day.recorded > 0 ? day.counts : null };
  });
}

export const lastDays = (days: readonly TrendDay[], count: number): TrendDay[] => days.slice(Math.max(0, days.length - count));

/** "all" = semua status; "absent" = tanpa Hadir tepat waktu (skala sumbu memperbesar yang tidak hadir). */
export type TrendFocus = "all" | "absent";

/** Seri kolom bertumpuk (jumlah siswa per status); hari tanpa catatan = null (kolom kosong). */
export function trendSeries(days: readonly TrendDay[], focus: TrendFocus = "all"): Array<{ key: string; label: string; color: string; values: Array<number | null> }> {
  return STATUS_SERIES.filter(s => focus === "all" || s.key !== "hadir")
    .map(s => ({ key: s.key, label: s.label, color: s.color, values: days.map(day => (day.counts ? day.counts[s.key] : null)) }));
}

/** Label sumbu y jumlah siswa: garis bantu pecahan (mis. 37,5) dibiarkan tanpa label. */
export function countAxisLabel(value: number): string {
  return Number.isInteger(value) ? whole.format(value) : "";
}

/** Label sumbu x ringkas untuk layar sempit: "2026-08-27" -> "27/8". */
export function compactDate(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day ?? ""}/${month ?? ""}`;
}

/** Baris penjelas di tooltip tren untuk satu hari. */
export function trendFooterText(day: TrendDay | undefined): string {
  if (!day) return "";
  if (!day.isClosed) return "Belum ditutup — data masuk setelah jam absensi berakhir";
  if (!day.isSchoolDay && !day.counts) return "Bukan hari sekolah";
  if (!day.counts || day.presentPct === null) return "Belum ada catatan absensi";
  return `Hadir tepat waktu + terlambat: ${pctText(day.presentPct)}`;
}

export interface TrendHighlights { readonly averagePct: number | null; readonly lowest: TrendDay | null; readonly schoolDays: number }

/**
 * Rata-rata hadir berbobot catatan (seperti server) + hari dengan persen hadir terendah. "Hari sekolah"
 * hanya menghitung hari sekolah bercatatan — kegiatan di hari libur yang ikut tercatat tidak dihitung.
 */
export function trendHighlights(days: readonly TrendDay[]): TrendHighlights {
  const recorded = days.filter(day => day.counts && day.presentPct !== null);
  if (!recorded.length) return { averagePct: null, lowest: null, schoolDays: 0 };
  let present = 0;
  let total = 0;
  for (const day of recorded) {
    const c = day.counts!;
    present += c.hadir + c.terlambat;
    total += c.hadir + c.terlambat + c.izin + c.sakit + c.alpha;
  }
  const lowest = recorded.reduce((low, day) => ((day.presentPct ?? 101) < (low.presentPct ?? 101) ? day : low));
  const schoolDays = recorded.filter(day => day.isSchoolDay).length;
  return { averagePct: total ? Math.round((present / total) * 1000) / 10 : null, lowest, schoolDays };
}

// ----------------------------------------------------------------------------- per kelas

type ClassRate = ClassAnalyticsDto["classes"][number];
export interface ClassRow { readonly key: string; readonly label: string; readonly value: number; readonly valueText: string; readonly detail: string; readonly attention: boolean }

export function classDetail(rate: { latePct: number | null; alphaPct: number | null; recorded: number }): string {
  if (rate.recorded <= 0) return "Belum ada catatan bulan ini";
  return `Terlambat ${pctText(rate.latePct ?? 0)} · Alpa ${pctText(rate.alphaPct ?? 0)} · ${whole.format(rate.recorded)} catatan`;
}

/** Baris batang per kelas: persen hadir terendah dulu (yang perlu perhatian di atas), tanpa catatan di akhir. */
export function classRows(classes: readonly ClassRate[]): ClassRow[] {
  const order = (c: ClassRate) => c.presentPct ?? Number.POSITIVE_INFINITY;
  return [...classes]
    .sort((a, b) => order(a) - order(b) || a.className.localeCompare(b.className, "id"))
    .map(c => ({
      key: c.classId ?? `tanpa-kelas-${c.className}`,
      label: c.className,
      value: c.presentPct ?? 0,
      valueText: pctText(c.presentPct),
      detail: classDetail(c),
      attention: c.presentPct !== null && c.presentPct < ATTENTION_PCT,
    }));
}

/**
 * Kelas perlu perhatian selalu tampil; kelas lain dibatasi agar total ~`limit` baris sampai daftar
 * dibuka (minimal 2 kelas pembanding tetap terlihat).
 */
export function splitClasses(rows: readonly ClassRow[], limit: number, expanded: boolean): { attention: ClassRow[]; others: ClassRow[]; hiddenCount: number } {
  const attention = rows.filter(r => r.attention);
  const rest = rows.filter(r => !r.attention);
  const shown = expanded ? rest.length : Math.min(rest.length, Math.max(2, limit - attention.length));
  return { attention, others: rest.slice(0, shown), hiddenCount: rest.length - shown };
}

// ----------------------------------------------------------------------------- hari ini

interface TodayCounts { readonly present: number; readonly late: number; readonly izin: number; readonly sakit: number; readonly alpha: number; readonly notYet: number }

export function todaySegments(t: TodayCounts): Array<{ key: string; label: string; value: number; color: string }> {
  return [
    { key: "present", label: "Hadir", value: t.present, color: "var(--att-hadir)" },
    { key: "late", label: "Terlambat", value: t.late, color: "var(--att-terlambat)" },
    { key: "izin", label: "Izin", value: t.izin, color: "var(--att-izin)" },
    { key: "sakit", label: "Sakit", value: t.sakit, color: "var(--att-sakit)" },
    { key: "alpha", label: "Alpa", value: t.alpha, color: "var(--att-alpha)" },
    { key: "notYet", label: "Belum absen", value: t.notYet, color: "var(--att-belum)" },
  ];
}

export function todayCaption(t: { present: number; late: number; eligible: number; notYet: number; isSchoolDay: boolean }): string {
  if (!t.isSchoolDay) return "Hari ini bukan hari sekolah";
  const base = `${whole.format(t.present + t.late)} dari ${whole.format(t.eligible)} siswa sudah hadir`;
  return t.notYet > 0 ? `${base} · ${whole.format(t.notYet)} belum absen` : base;
}

// ----------------------------------------------------------------------------- penjaga bentuk data

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isDate = (v: unknown): v is string => typeof v === "string" && parseLocalDate(v) !== null;
const isPct = (v: unknown) => v === null || typeof v === "number";

function isRate(v: unknown): boolean {
  return isObject(v) && typeof v.recorded === "number" && isPct(v.presentPct) && isObject(v.counts);
}

export function isSchoolTrend(v: unknown): v is SchoolTrendDto {
  return isObject(v) && isDate(v.from) && isDate(v.to) && isDate(v.closedThrough) && v.from <= v.to && Array.isArray(v.days)
    && v.days.every(d => isRate(d) && isDate((d as Record<string, unknown>).date) && typeof (d as Record<string, unknown>).isSchoolDay === "boolean");
}

export function isClassAnalytics(v: unknown): v is ClassAnalyticsDto {
  return isObject(v) && isObject(v.period) && isDate(v.period.closedThrough) && isRate(v.school) && Array.isArray(v.classes)
    && v.classes.every(c => isRate(c) && typeof (c as Record<string, unknown>).className === "string");
}

export function isSummaryAnalytics(v: unknown): v is SummaryAnalyticsDto {
  return isRate(v) && isObject(v) && typeof v.month === "string" && typeof v.prevMonth === "string" && isDate(v.closedThrough) && isPct(v.deltaPp);
}
