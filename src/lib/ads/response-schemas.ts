import { z } from "zod";
import { dateOutSchema } from "@/lib/academics/schema-common";
import { SPONSOR_STATUSES } from "@/lib/sponsors/constants";
import { AD_DISPLAY_STATUSES, AD_LINK_TYPES, AD_STATUSES, AD_TARGET_SCOPES } from "./constants";

/** Skema respons domain iklan (OpenAPI + validasi respons di mode test). Uang = rupiah bulat, hari = WIB. */

const dateTime = z.string().meta({ format: "date-time" });
const money = z.int();
const displayStatus = z.enum(AD_DISPLAY_STATUSES).meta({ description: "Status turunan; \"Aktif\" di UI = LIVE (label di /meta/enums AdDisplayStatus)." });

export const adTargetSchema = z
  .object({ provinceCode: z.string().nullable(), cityCode: z.string().nullable(), schoolId: z.string().nullable(), label: z.string() })
  .meta({ id: "AdTarget" });

export const adSchema = z
  .object({
    id: z.string(),
    sponsorId: z.string(),
    title: z.string(),
    imageFileId: z.string().meta({ description: "Banner privat: GET /api/v1/files/{id} (pemilik & super admin)." }),
    imageUrl: z.string().nullable().meta({ description: "URL publik (/media) — hanya ada selama iklan disetujui/dijeda." }),
    linkType: z.enum(AD_LINK_TYPES),
    targetUrl: z.string(),
    startAt: dateTime,
    endAt: dateTime,
    status: z.enum(AD_STATUSES),
    displayStatus,
    isActive: z.boolean().meta({ description: "displayStatus = LIVE." }),
    targetScope: z.enum(AD_TARGET_SCOPES),
    targets: z.array(adTargetSchema),
    cpcAmount: money.meta({ description: "Perkiraan saat DRAFT; snapshot CPC default platform setiap submit." }),
    submittedAt: dateTime.nullable().meta({ description: "Juga token CAS approve/reject." }),
    reviewNote: z.string().nullable(),
    reviewedAt: dateTime.nullable(),
    createdAt: dateTime,
    updatedAt: dateTime,
  })
  .meta({ id: "Ad" });
export type AdDto = z.input<typeof adSchema>;

export const updateAdResultSchema = z
  .object({ ad: adSchema, reReviewTriggered: z.boolean().meta({ description: "true = konten iklan aktif berubah -> kembali PENDING_REVIEW." }) })
  .meta({ id: "UpdateAdResult" });

export const reviewAdSchema = adSchema
  .extend({
    sponsor: z.object({ id: z.string(), companyName: z.string(), status: z.enum(SPONSOR_STATUSES), balance: money }),
    urlHost: z.string().nullable(),
    isPunycodeHost: z.boolean().meta({ description: "Host IDN (xn--): periksa kemungkinan homograf." }),
  })
  .meta({ id: "ReviewAd" });
export type ReviewAdDto = z.input<typeof reviewAdSchema>;

export const bannerSchema = z
  .object({ fileId: z.string(), mimeType: z.string(), width: z.int(), height: z.int(), sizeBytes: z.int() })
  .meta({ id: "AdBanner" });

export const targetSchoolSchema = z
  .object({ id: z.string(), name: z.string(), provinceCode: z.string(), provinceName: z.string(), cityCode: z.string(), cityName: z.string() })
  .meta({ id: "AdTargetSchool" });

// ----------------------------------------------------------------------------- siswa

export const servedAdSchema = z
  .object({
    token: z.string().meta({ description: "Kirim ke /student/ads/impressions & /student/ads/clicks." }),
    adId: z.string(),
    title: z.string(),
    imageUrl: z.string(),
    targetUrl: z.string(),
    linkType: z.enum(AD_LINK_TYPES),
    sponsorName: z.string(),
  })
  .meta({ id: "ServedAd" });

export const servedAdsSchema = z
  .object({ ads: z.array(servedAdSchema), refreshAfterSeconds: z.int() })
  .meta({ id: "ServedAds" });

export const impressionsResultSchema = z
  .object({ accepted: z.int(), duplicate: z.int(), rejected: z.int() })
  .meta({ id: "AdImpressionsResult" });

export const clickResultSchema = z
  .object({
    targetUrl: z.string().nullable().meta({ description: "null bila iklan sudah tidak tayang (jangan buka tautan)." }),
    linkType: z.enum(AD_LINK_TYPES),
  })
  .meta({ id: "AdClickResult" });

// ----------------------------------------------------------------------------- analitik

export const periodSchema = z
  .object({ from: dateOutSchema, to: dateOutSchema, prevFrom: dateOutSchema, prevTo: dateOutSchema, days: z.int() })
  .meta({ id: "AnalyticsPeriod" });

const kpi = (valueSchema: z.ZodType) =>
  z.object({ value: valueSchema, previous: valueSchema, changePct: z.number().nullable().meta({ description: "% vs periode sebelumnya (1 desimal); null bila sebelumnya 0." }) });

export const analyticsSummarySchema = z
  .object({
    period: periodSchema,
    kpis: z.object({
      impressions: kpi(z.int()),
      clicks: kpi(z.int()),
      uniqueClicks: kpi(z.int()).meta({ description: "COUNT DISTINCT siswa yang mengklik dalam periode." }),
      ctr: kpi(z.number().nullable()).meta({ description: "clicks/impressions×100, 2 desimal; null tanpa impresi. Bisa > 100 (impresi didedupe 30 menit)." }),
      spend: kpi(money),
      chargedClicks: kpi(z.int()),
    }),
  })
  .meta({ id: "AdAnalyticsSummary" });

export const dailyPointSchema = z
  .object({ date: dateOutSchema, impressions: z.int(), clicks: z.int(), uniqueClicks: z.int(), chargedClicks: z.int(), spend: money })
  .meta({ id: "AdAnalyticsDay" });

export const analyticsSeriesSchema = z
  .object({ period: periodSchema, days: z.array(dailyPointSchema).meta({ description: "Terisi nol per hari. Klik unik harian = distinct per hari (jumlahnya bukan klik unik periode)." }) })
  .meta({ id: "AdAnalyticsSeries" });

export const breakdownSchema = z
  .object({
    period: periodSchema,
    dimension: z.enum(["device", "province"]),
    items: z.array(z.object({ key: z.string(), label: z.string(), clicks: z.int(), sharePct: z.number() })),
  })
  .meta({ id: "AdAnalyticsBreakdown" });

export const adPerformanceSchema = z
  .object({
    adId: z.string(),
    title: z.string(),
    imageUrl: z.string().nullable(),
    status: z.enum(AD_STATUSES),
    displayStatus,
    isActive: z.boolean(),
    startAt: dateTime,
    endAt: dateTime,
    impressions: z.int(),
    clicks: z.int(),
    uniqueClicks: z.int(),
    ctr: z.number().nullable(),
    spend: money,
  })
  .meta({ id: "AdPerformanceRow" });
export type AdPerformanceDto = z.input<typeof adPerformanceSchema>;

