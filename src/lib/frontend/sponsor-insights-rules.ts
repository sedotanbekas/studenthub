import type { AdDto, AdPerformanceDto, AnalyticsDay, AnalyticsPreset, BreakdownItem, SponsorBalanceDto, SponsorDto } from "./ad-types";
import { shortDate } from "./chart-rules";
import { demoAdPerformance, demoAnalyticsBreakdown, demoAnalyticsSeries, demoAnalyticsSummary, demoBalance, demoSponsorAds, demoSponsorProfile, wibToday } from "./demo-ads";
import { label, number, rupiah } from "./format";

/**
 * Aturan murni beranda & analitik sponsor (tanpa DOM): pilihan metrik/periode, format CTR & nilai,
 * ringkasan tren, perkiraan umur saldo, nada status iklan, urutan tabel performa, dan data demo per jalur.
 */
export type InsightMetric = "impressions" | "clicks" | "spend";
export type PerformanceSort = "clicks" | "impressions" | "ctr" | "spend";
export type AdDisplayStatus = AdDto["displayStatus"];

export const METRIC_OPTIONS: readonly { readonly value: InsightMetric; readonly label: string }[] = [
  { value: "impressions", label: "Tayangan" }, { value: "clicks", label: "Klik" }, { value: "spend", label: "Biaya" },
];
export const PERIOD_OPTIONS: readonly { readonly value: AnalyticsPreset; readonly label: string }[] = [
  { value: "7d", label: "7 hari" }, { value: "30d", label: "30 hari" },
];
export const SORT_OPTIONS: readonly { readonly value: PerformanceSort; readonly label: string }[] = [
  { value: "clicks", label: "Klik" }, { value: "impressions", label: "Tayangan" }, { value: "ctr", label: "CTR" }, { value: "spend", label: "Biaya" },
];

const DOT = " · ";
const presetDays = (preset: AnalyticsPreset): number => (preset === "30d" ? 30 : 7);

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

const LONG_DATE = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" });
/** "Sabtu, 26 September 2026" menurut tanggal WIB. */
export function longDate(now: Date): string {
  return LONG_DATE.format(now);
}

const SHORT_DATE = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });
/** Waktu ISO -> "5 Nov" menurut tanggal WIB. */
export function wibShortDate(iso: string): string {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? SHORT_DATE.format(time) : "—";
}

export const periodLabel =(preset: AnalyticsPreset): string => `${presetDays(preset)} hari terakhir`;
export const compareLabel = (preset: AnalyticsPreset): string => `vs ${presetDays(preset)} hari sebelumnya`;

/** "20–26 Sep 2026", "28 Agu – 26 Sep 2026", atau lintas tahun "28 Des 2025 – 3 Jan 2026". */
export function rangeLabel(period: { readonly from: string; readonly to: string }): string {
  const [fromYear, fromMonth] = period.from.split("-");
  const [toYear, toMonth] = period.to.split("-");
  if (fromYear !== toYear) return `${shortDate(period.from)} ${fromYear} – ${shortDate(period.to)} ${toYear}`;
  if (fromMonth !== toMonth) return `${shortDate(period.from)} – ${shortDate(period.to)} ${toYear}`;
  return `${Number(period.from.slice(8))}–${shortDate(period.to)} ${toYear}`;
}

/** CTR dalam persen dengan dua desimal (sama dengan API); null bila belum ada tayangan. */
export function ctrPercent(clicks: number, impressions: number): number | null {
  return impressions > 0 ? Math.round((clicks / impressions) * 10_000) / 100 : null;
}
const ONE_DECIMAL = new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export function formatCtr(ctr: number | null): string {
  return ctr === null || !Number.isFinite(ctr) ? "—" : `${ONE_DECIMAL.format(ctr)}%`;
}

export function formatMetric(metric: InsightMetric, value: number): string {
  return metric === "spend" ? rupiah(value) : number(value);
}

export function metricValues(days: readonly AnalyticsDay[], metric: InsightMetric): number[] {
  return days.map(d => d[metric]);
}
/** CTR harian untuk sparkline; hari tanpa tayangan dilewati. */
export function ctrValues(days: readonly AnalyticsDay[]): number[] {
  return days.flatMap(d => { const ctr = ctrPercent(d.clicks, d.impressions); return ctr === null ? [] : [ctr]; });
}

/** Baris kaki tooltip grafik tren: metrik lain pada hari yang sama. */
export function trendFooter(day: AnalyticsDay, metric: InsightMetric): string {
  const ctr = `CTR ${formatCtr(ctrPercent(day.clicks, day.impressions))}`;
  if (metric === "impressions") return `Klik ${number(day.clicks)}${DOT}${ctr}`;
  if (metric === "clicks") return `Tayangan ${number(day.impressions)}${DOT}${ctr}`;
  return `${number(day.chargedClicks)} klik ditagih dari ${number(day.clicks)} klik`;
}

/** Lebar satu label tanggal sumbu-x (sama dengan slot xLabelCount di chart-rules). */
const LABEL_SLOT_PX = 64;
/**
 * Tanggal yang berjarak kurang dari satu slot label dari tanggal TERAKHIR pada lebar plot tertentu.
 * TrendChart memilih label sendiri (xLabelCount) dan selalu menampilkan label terakhir rata kanan; di
 * HP (30 hari, ~9px per hari) label sebelumnya bisa menimpanya. Dikosongkan lewat labelFormat — tidak
 * menebak langkah label kit, hanya menjaga ruang label terakhir.
 */
export function tailCrowdedDates(dates: readonly string[], plotWidth: number): ReadonlySet<string> {
  const last = dates.length - 1;
  if (last < 1 || plotWidth <= 0) return new Set();
  const reach = Math.ceil(LABEL_SLOT_PX / (plotWidth / last));
  return new Set(dates.slice(Math.max(0, last - reach + 1), last));
}

export interface TrendSummary { readonly total: number; readonly average: number; readonly peak: number | null }
/** Total, rata-rata per hari (dibulatkan), dan indeks hari tertinggi (null bila semua nol). */
export function trendSummary(values: readonly number[]): TrendSummary {
  const total = values.reduce((sum, v) => sum + v, 0);
  if (!values.length || total <= 0) return { total, average: 0, peak: null };
  const peak = values.reduce((best, v, i) => (v > (values[best] ?? 0) ? i : best), 0);
  return { total, average: Math.round(total / values.length), peak };
}

const RUNWAY_MAX_DAYS = 90;
/** Perkiraan berapa lama saldo cukup pada laju biaya `days` hari terakhir; null bila belum ada biaya. */
export function runwayLabel(balance: number, spend: number, days: number): string | null {
  const perDay = days > 0 ? spend / days : 0;
  if (perDay <= 0) return null;
  const pace = `pada laju ${days} hari terakhir`;
  const remaining = Math.floor(balance / perDay);
  if (remaining < 1) return `Kurang dari sehari ${pace}`;
  if (remaining > RUNWAY_MAX_DAYS) return `Cukup untuk lebih dari 3 bulan ${pace}`;
  return `Cukup untuk ± ${number(remaining)} hari ${pace}`;
}

/** "empty": kurang dari biaya satu klik (iklan berhenti tayang); "low": di bawah ambang peringatan. */
export function balanceAlert(balance: Pick<SponsorBalanceDto, "balance" | "defaultCpcAmount" | "lowBalanceThreshold">): "empty" | "low" | null {
  if (balance.balance < balance.defaultCpcAmount) return "empty";
  return balance.balance < balance.lowBalanceThreshold ? "low" : null;
}

export interface AccountNotice { readonly tone: "info" | "warning"; readonly title: string; readonly text: string }
export function accountNotice(status: SponsorDto["status"], reason: string | null): AccountNotice | null {
  if (status === "PENDING") return { tone: "info", title: "Akun sedang ditinjau", text: "Anda sudah bisa menyiapkan draf kampanye; pengajuan iklan & top-up aktif setelah akun disetujui." };
  if (status === "SUSPENDED") {
    const why = reason ? ` Alasan: ${reason}` : "";
    return { tone: "warning", title: "Akun ditangguhkan", text: `Iklan Anda berhenti tayang sementara dan pengajuan baru dinonaktifkan.${why} Hubungi tim Student Hub bila ada pertanyaan.` };
  }
  return null;
}

const TONES: Record<AdDisplayStatus, "green" | "amber" | "red" | "neutral"> = {
  LIVE: "green", SCHEDULED: "amber", PENDING_REVIEW: "amber", NO_BALANCE: "red", REJECTED: "red", SPONSOR_INACTIVE: "red",
  DRAFT: "neutral", PAUSED: "neutral", ENDED: "neutral", ARCHIVED: "neutral",
};
export const adTone = (status: AdDisplayStatus): "green" | "amber" | "red" | "neutral" => TONES[status] ?? "neutral";

/** Sama dengan sortAdRows server: menurun menurut kunci; seri -> klik, tayangan (menurun), judul (naik). */
export function sortPerformance<T extends Pick<AdPerformanceDto, "title" | "impressions" | "clicks" | "ctr" | "spend">>(rows: readonly T[], sort: PerformanceSort): T[] {
  const value = (row: T): number => (sort === "ctr" ? (row.ctr ?? -1) : row[sort]);
  return [...rows].sort((a, b) => value(b) - value(a) || b.clicks - a.clicks || b.impressions - a.impressions || a.title.localeCompare(b.title));
}

export function breakdownBars(items: readonly BreakdownItem[]): { key: string; label: string; value: number; detail: string }[] {
  return items.map(item => ({ key: item.key, label: item.label, value: item.clicks, detail: `${ONE_DECIMAL.format(item.sharePct)}% dari total klik` }));
}

/** Jalur API dengan query; parameter kosong dilewati. */
export function insightsPath(base: string, params: Readonly<Record<string, string | undefined>>): string {
  const query = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v ?? "")}`).join("&");
  return query ? `${base}?${query}` : base;
}

const SUMMARY_ORDER: readonly AdDisplayStatus[] = ["LIVE", "SCHEDULED", "PENDING_REVIEW", "NO_BALANCE", "PAUSED", "DRAFT", "REJECTED", "SPONSOR_INACTIVE", "ENDED"];
/** "2 aktif · 1 menunggu tinjauan · 1 draf" (arsip tidak dihitung). */
export function statusSummary(ads: readonly Pick<AdDto, "displayStatus">[]): string {
  return SUMMARY_ORDER.flatMap(status => {
    const count = ads.filter(ad => ad.displayStatus === status).length;
    return count ? [`${number(count)} ${label(status).toLowerCase()}`] : [];
  }).join(DOT);
}
/** Iklan yang sedang tayang, urut klik terbanyak (lalu judul) menurut tabel performa. */
export function liveByClicks<T extends Pick<AdDto, "id" | "displayStatus" | "title">>(ads: readonly T[], perf: readonly Pick<AdPerformanceDto, "adId" | "clicks">[]): T[] {
  const clicks = new Map(perf.map(p => [p.adId, p.clicks]));
  return ads.filter(ad => ad.displayStatus === "LIVE").sort((a, b) => (clicks.get(b.id) ?? 0) - (clicks.get(a.id) ?? 0) || a.title.localeCompare(b.title));
}
export function adOptionLabel(ad: Pick<AdDto, "displayStatus" | "title">): string {
  return ad.displayStatus === "LIVE" ? ad.title : `${ad.title} (${label(ad.displayStatus)})`;
}

// ----------------------------------------------------------------------------- data demo per jalur

const presetOf = (value: string | null): AnalyticsPreset => (value === "30d" ? "30d" : "7d");
const sortOf = (value: string | null): PerformanceSort => SORT_OPTIONS.find(o => o.value === value)?.value ?? "clicks";

function demoBreakdown(params: URLSearchParams, today: string): unknown {
  const preset = presetOf(params.get("preset"));
  const full = demoAnalyticsBreakdown(params.get("dimension") === "province" ? "province" : "device", preset, today);
  const adId = params.get("adId");
  if (!adId) return full;
  // Satu iklan: porsi sama, jumlah klik mengikuti iklan itu (tanpa klik -> sebaran kosong seperti API).
  const clicks = demoAnalyticsSummary(preset, today, adId).kpis.clicks.value;
  return { ...full, items: clicks ? full.items.map(i => ({ ...i, clicks: Math.round((clicks * i.sharePct) / 100) })) : [] };
}

const DEMO_PATHS: Record<string, (params: URLSearchParams, today: string) => unknown> = {
  "/sponsor/profile": (_, today) => demoSponsorProfile(today),
  "/sponsor/balance": (_, today) => demoBalance(today),
  "/sponsor/ads": (_, today) => demoSponsorAds(today),
  "/sponsor/analytics/summary": (p, today) => demoAnalyticsSummary(presetOf(p.get("preset")), today, p.get("adId") ?? undefined),
  "/sponsor/analytics/timeseries": (p, today) => demoAnalyticsSeries(presetOf(p.get("preset")), today, p.get("adId") ?? undefined),
  "/sponsor/analytics/breakdown": demoBreakdown,
  "/sponsor/analytics/ads": (p, today) => sortPerformance(demoAdPerformance(presetOf(p.get("preset")), today), sortOf(p.get("sort"))).slice(0, Number(p.get("limit")) || undefined),
};

/** Data demo untuk jalur beranda/analitik sponsor (termasuk query); undefined bila bukan jalur ini. */
export function demoInsights(path: string, today: string = wibToday()): unknown {
  const [base = "", query = ""] = path.split("?");
  return DEMO_PATHS[base]?.(new URLSearchParams(query), today);
}
