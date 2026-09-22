import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { ANALYTICS_MAX_RANGE_DAYS } from "./constants";
import { adPerformanceSchema, analyticsSeriesSchema, analyticsSummarySchema, breakdownSchema } from "./response-schemas";
import { adTableQuery, analyticsQuery, breakdownQuery } from "./schemas";

/** Kontrak analitik iklan (hari WIB). Sponsor: miliknya; super admin: wajib ?sponsorId. */
const TAG = "Iklan — Analitik";
const COMMON = `Periode: preset 7d/30d (termasuk hari ini) atau from+to (<= ${ANALYTICS_MAX_RANGE_DAYS} hari, to <= hari ini). Periode pembanding = rentang sama panjang tepat sebelum from.`;
const ERRORS = ["ANALYTICS_RANGE_INVALID", "SPONSOR_ID_REQUIRED", "SPONSOR_NOT_FOUND", "AD_NOT_FOUND"] as const;

export const analyticsSummaryContract = defineContract({
  id: "getAdAnalyticsSummary",
  method: "GET",
  path: "/api/v1/sponsor/analytics/summary",
  tag: TAG,
  summary: "KPI: tayang, klik, klik unik, CTR, biaya + % perubahan",
  description: COMMON,
  action: "ads.analytics.read",
  query: analyticsQuery,
  response: analyticsSummarySchema,
  errors: ERRORS,
});

export const analyticsSeriesContract = defineContract({
  id: "getAdAnalyticsTimeseries",
  method: "GET",
  path: "/api/v1/sponsor/analytics/timeseries",
  tag: TAG,
  summary: "Deret harian (total vs unik) terisi nol",
  description: COMMON,
  action: "ads.analytics.read",
  query: analyticsQuery,
  response: analyticsSeriesSchema,
  errors: ERRORS,
});

export const analyticsBreakdownContract = defineContract({
  id: "getAdAnalyticsBreakdown",
  method: "GET",
  path: "/api/v1/sponsor/analytics/breakdown",
  tag: TAG,
  summary: "Sebaran klik per perangkat atau provinsi (provinsi sekolah)",
  description: `${COMMON} sharePct satu desimal selalu berjumlah 100.`,
  action: "ads.analytics.read",
  query: breakdownQuery,
  response: breakdownSchema,
  errors: ERRORS,
});

export const analyticsAdsContract = defineContract({
  id: "getAdAnalyticsPerAd",
  method: "GET",
  path: "/api/v1/sponsor/analytics/ads",
  tag: TAG,
  summary: "Tabel performa per iklan (top 3 = sort=clicks&limit=3)",
  description: COMMON,
  action: "ads.analytics.read",
  query: adTableQuery,
  response: z.array(adPerformanceSchema),
  pagination: "page",
  errors: ERRORS,
});

export const adsAnalyticsContracts: readonly AnyContract[] = [analyticsSummaryContract, analyticsSeriesContract, analyticsBreakdownContract, analyticsAdsContract];
