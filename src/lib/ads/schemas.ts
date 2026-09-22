import { z } from "zod";
import { mapDeviceType } from "./click-rules";
import { entityIdSchema, localDateSchema } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import {
  AD_LINK_TYPES, AD_STATUSES, AD_TARGET_SCOPES, AD_TITLE_MAX, AD_TITLE_MIN, AD_URL_MAX, ANALYTICS_PRESETS, ANALYTICS_SORTS,
  IMPRESSION_BATCH_MAX, REPORTED_DEVICE_TYPES, MAX_TARGETS_PER_AD, REVIEW_NOTE_MAX, REVIEW_NOTE_MIN,
} from "./constants";

/** Skema zod input domain iklan (validasi runtime + OpenAPI). */

const collapse = (value: string): string => value.replace(/\s+/g, " ").trim();
const cleanText = (min: number, max: number, label: string) =>
  z
    .string()
    .transform(collapse)
    .pipe(z.string().min(min, `${label} minimal ${min} karakter.`).max(max, `${label} maksimal ${max} karakter.`))
    .meta({ minLength: min, maxLength: max });

const instant = z.iso
  .datetime({ offset: true, error: "Waktu harus ISO-8601 dengan zona, mis. 2026-10-01T00:00:00+07:00." })
  .transform((value) => new Date(value))
  .meta({ format: "date-time", example: "2026-10-01T00:00:00+07:00" });

const hasAnyField = (value: Record<string, unknown>): boolean => Object.values(value).some((v) => v !== undefined);

export const adIdParams = z.object({ id: entityIdSchema.meta({ description: "Id iklan." }) });

const targetsSchema = z
  .strictObject({
    provinceCodes: z.array(z.string().trim()).max(MAX_TARGETS_PER_AD).optional().meta({ description: "Kode provinsi 2 digit (cakupan PROVINCE)." }),
    cityCodes: z.array(z.string().trim()).max(MAX_TARGETS_PER_AD).optional().meta({ description: "Kode kab/kota \"32.73\" (cakupan CITY)." }),
    schoolIds: z.array(z.string().trim()).max(MAX_TARGETS_PER_AD).optional().meta({ description: "Id sekolah aktif (cakupan SCHOOL)." }),
  })
  .meta({ id: "AdTargetsInput", description: "Tepat satu daftar sesuai targetScope (ALL = kosong). Maks 100 target." });

const adFields = {
  title: cleanText(AD_TITLE_MIN, AD_TITLE_MAX, "Judul"),
  imageFileId: entityIdSchema.meta({ description: "Id banner hasil POST /sponsor/banners (milik sponsor sendiri)." }),
  linkType: z.enum(AD_LINK_TYPES),
  targetUrl: z.string().max(AD_URL_MAX + 100).meta({ description: "EXTERNAL_URL: https:// saja. DEEP_LINK: skema aplikasi di allowlist super admin. javascript:/data:/intent:/http: ditolak." }),
  startAt: instant,
  endAt: instant.meta({ description: "Iklan berakhir (ENDED) saat endAt <= sekarang; perpanjang untuk menayangkan lagi." }),
  targetScope: z.enum(AD_TARGET_SCOPES),
  targets: targetsSchema,
};

export const createAdBody = z
  .strictObject({ ...adFields, targetScope: adFields.targetScope.default("ALL"), targets: targetsSchema.default({}) })
  .meta({ id: "CreateAdInput" });
export type CreateAdInput = z.output<typeof createAdBody>;

export const updateAdBody = z
  .strictObject({
    title: adFields.title.optional(),
    imageFileId: adFields.imageFileId.optional(),
    linkType: adFields.linkType.optional(),
    targetUrl: adFields.targetUrl.optional(),
    startAt: adFields.startAt.optional(),
    endAt: adFields.endAt.optional(),
    targetScope: adFields.targetScope.optional(),
    targets: targetsSchema.optional().meta({ description: "Menggantikan seluruh target (wajib bila targetScope diubah ke selain ALL)." }),
    expectedUpdatedAt: z.iso.datetime({ offset: true }).optional().meta({ description: "Token konkurensi opsional: updatedAt yang sedang ditampilkan; berbeda -> 409 STATE_CONFLICT." }),
  })
  .refine(hasAnyField, "Minimal satu field harus diubah.")
  .meta({ id: "UpdateAdInput" });
export type UpdateAdInput = z.output<typeof updateAdBody>;

const searchSchema = z.string().trim().min(1).max(100);

export const ownAdsQuery = pageQuerySchema.extend({ status: z.enum(AD_STATUSES).optional(), q: searchSchema.optional().meta({ description: "Cari judul." }) });
export type OwnAdsQuery = z.output<typeof ownAdsQuery>;

export const platformAdsQuery = pageQuerySchema.extend({
  status: z.enum(AD_STATUSES).default("PENDING_REVIEW").meta({ description: "Default PENDING_REVIEW (antrean, submittedAt terlama dulu)." }),
  sponsorId: entityIdSchema.optional(),
  q: searchSchema.optional().meta({ description: "Cari judul." }),
});
export type PlatformAdsQuery = z.output<typeof platformAdsQuery>;

const reviewNote = cleanText(REVIEW_NOTE_MIN, REVIEW_NOTE_MAX, "Alasan");
const submittedAtToken = z.iso
  .datetime({ offset: true })
  .meta({ description: "submittedAt yang dilihat reviewer (token CAS); berbeda -> 409 AD_REVIEW_STALE." });

export const approveAdBody = z.strictObject({ submittedAt: submittedAtToken }).meta({ id: "ApproveAdInput" });
export const rejectAdBody = z.strictObject({ submittedAt: submittedAtToken, reason: reviewNote }).meta({ id: "RejectAdInput" });
export const takedownAdBody = z.strictObject({ reason: reviewNote }).meta({ id: "TakedownAdInput" });

export const bannerUploadBody = z
  .strictObject({
    file: z.file().min(1, "Berkas banner wajib diisi.").meta({ description: "JPEG/PNG/WebP, rasio 2:1 (±2%), lebar >= 800 px, maks 5 MiB. Disimpan WebP 1200×600 tanpa EXIF, PRIVAT sampai iklan disetujui." }),
  })
  .meta({ id: "UploadBannerInput" });
export type BannerUploadInput = z.output<typeof bannerUploadBody>;

export const targetingSchoolsQuery = pageQuerySchema.extend({
  q: searchSchema.optional().meta({ description: "Cari nama sekolah." }),
  provinceCode: z.string().regex(/^\d{2}$/).optional(),
  cityCode: z.string().regex(/^\d{2}\.\d{2}$/).optional(),
});
export type TargetingSchoolsQuery = z.output<typeof targetingSchoolsQuery>;

// ----------------------------------------------------------------------------- event siswa

const tokenSchema = z.string().min(20).max(2_000).meta({ description: "Token event dari GET /student/ads (berlaku 6 jam, terikat siswa)." });

export const impressionsBody = z
  .strictObject({ events: z.array(z.strictObject({ token: tokenSchema })).min(1).max(IMPRESSION_BATCH_MAX) })
  .meta({ id: "AdImpressionsInput", description: `Kirim saat slide benar-benar terlihat; batch 1-${IMPRESSION_BATCH_MAX}.` });
export type ImpressionsInput = z.output<typeof impressionsBody>;

export const clickBody = z
  .strictObject({ token: tokenSchema, deviceType: z.enum(REPORTED_DEVICE_TYPES).default("MOBILE").transform(mapDeviceType).meta({ description: "Dilaporkan app (expo-device `Device.deviceType`); PHONE/UNKNOWN -> MOBILE, TV -> DESKTOP." }) })
  .meta({ id: "AdClickInput" });
export type ClickInput = z.output<typeof clickBody>;

// ----------------------------------------------------------------------------- analitik

export const analyticsQuery = z.object({
  preset: z.enum(Object.keys(ANALYTICS_PRESETS) as ["7d", "30d"]).optional().meta({ description: "7d/30d (termasuk hari ini, WIB). Default 7d bila from/to kosong." }),
  from: localDateSchema.optional().meta({ description: "Awal rentang kustom (WIB), bersama to; maks 92 hari." }),
  to: localDateSchema.optional(),
  adId: entityIdSchema.optional().meta({ description: "Batasi ke satu iklan milik sponsor (lainnya -> 404)." }),
  sponsorId: entityIdSchema.optional().meta({ description: "Wajib untuk super admin (400 SPONSOR_ID_REQUIRED); diabaikan untuk sponsor." }),
});
export type AnalyticsQuery = z.output<typeof analyticsQuery>;

export const breakdownQuery = analyticsQuery.extend({ dimension: z.enum(["device", "province"]).default("device") });
export type BreakdownQuery = z.output<typeof breakdownQuery>;

export const adTableQuery = analyticsQuery.extend({
  sort: z.enum(ANALYTICS_SORTS).default("clicks").meta({ description: "Top 3 = sort=clicks&limit=3." }),
  page: pageQuerySchema.shape.page,
  limit: pageQuerySchema.shape.limit,
});
export type AdTableQuery = z.output<typeof adTableQuery>;
