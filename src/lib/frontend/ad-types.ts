import type { AdDto, AdPerformanceDto, ReviewAdDto } from "@/lib/ads/response-schemas";
import type { AdSettingsDto, LedgerEntryDto, PlatformTopUpDto, SponsorBalanceDto, SponsorDto, SponsorListItemDto, TopUpDto } from "@/lib/sponsors/response-schemas";

/**
 * Tipe respons API iklan & sponsor untuk frontend. DTO yang sudah diekspor backend dipakai ulang;
 * yang skemanya generik di backend (KPI analitik, iklan tayang siswa) ditulis ulang persis di sini.
 */
export type { AdDto, AdPerformanceDto, AdSettingsDto, LedgerEntryDto, PlatformTopUpDto, ReviewAdDto, SponsorBalanceDto, SponsorDto, SponsorListItemDto, TopUpDto };

export type AdLinkType = "EXTERNAL_URL" | "DEEP_LINK";

/** GET /student/ads — satu iklan yang boleh tayang untuk siswa ini (token event terikat siswa, 6 jam). */
export interface ServedAd {
  readonly token: string;
  readonly adId: string;
  readonly title: string;
  readonly imageUrl: string;
  readonly targetUrl: string;
  readonly linkType: AdLinkType;
  readonly sponsorName: string;
}
export interface ServedAds { readonly ads: readonly ServedAd[]; readonly refreshAfterSeconds: number }
/** POST /student/ads/clicks — `targetUrl` null berarti iklan sudah tidak tayang (jangan buka apa pun). */
export interface AdClickResult { readonly targetUrl: string | null; readonly linkType: AdLinkType }

export interface AnalyticsPeriod { readonly from: string; readonly to: string; readonly prevFrom: string; readonly prevTo: string; readonly days: number }
export interface Kpi<T = number> { readonly value: T; readonly previous: T; readonly changePct: number | null }
export interface AnalyticsSummary {
  readonly period: AnalyticsPeriod;
  readonly kpis: { readonly impressions: Kpi; readonly clicks: Kpi; readonly uniqueClicks: Kpi; readonly ctr: Kpi<number | null>; readonly spend: Kpi; readonly chargedClicks: Kpi };
}
export interface AnalyticsDay { readonly date: string; readonly impressions: number; readonly clicks: number; readonly uniqueClicks: number; readonly chargedClicks: number; readonly spend: number }
export interface AnalyticsSeries { readonly period: AnalyticsPeriod; readonly days: readonly AnalyticsDay[] }
export interface BreakdownItem { readonly key: string; readonly label: string; readonly clicks: number; readonly sharePct: number }
export interface AnalyticsBreakdown { readonly period: AnalyticsPeriod; readonly dimension: "device" | "province"; readonly items: readonly BreakdownItem[] }
export type AnalyticsPreset = "7d" | "30d";

/** GET /sponsor/targeting/schools — sekolah aktif yang bisa dijadikan target. */
export interface TargetSchool { readonly id: string; readonly name: string; readonly provinceCode: string; readonly provinceName: string; readonly cityCode: string; readonly cityName: string }
