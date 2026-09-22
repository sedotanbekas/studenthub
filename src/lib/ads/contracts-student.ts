import { defineContract, type AnyContract } from "@/lib/http/contract";
import { IMPRESSION_BATCH_MAX, MAX_ADS_PER_SLIDER, MAX_ADS_PER_SPONSOR_IN_SLIDER } from "./constants";
import { clickResultSchema, impressionsResultSchema, servedAdsSchema } from "./response-schemas";
import { clickBody, impressionsBody } from "./schemas";

/** Kontrak siswa ACTIVE: slider iklan, laporan impresi & klik. */
const TAG = "Iklan — Siswa";

export const serveAdsContract = defineContract({
  id: "listStudentAds",
  method: "GET",
  path: "/api/v1/student/ads",
  tag: TAG,
  summary: "Iklan slider untuk siswa",
  description: `Kandidat: disetujui, dalam jadwal, sponsor disetujui & bersaldo >= CPC, target cocok dengan sekolah siswa. Rotasi deterministik per jam (WIB), maks ${MAX_ADS_PER_SLIDER} iklan & ${MAX_ADS_PER_SPONSOR_IN_SLIDER} per sponsor. Setiap iklan membawa token event (6 jam, terikat siswa). Muat ulang setelah refreshAfterSeconds.`,
  action: "ads.serve",
  response: servedAdsSchema,
});

export const recordImpressionsContract = defineContract({
  id: "recordAdImpressions",
  method: "POST",
  path: "/api/v1/student/ads/impressions",
  tag: TAG,
  summary: "Laporkan impresi (slide terlihat), batch",
  description: `1-${IMPRESSION_BATCH_MAX} token per permintaan. Impresi dihitung maks sekali per 30 menit per siswa/iklan (duplicate); token tidak sah/milik siswa lain dihitung rejected. Impresi tidak pernah ditagih.`,
  action: "ads.event",
  body: impressionsBody,
  response: impressionsResultSchema,
  rateLimit: { limiter: "AD_IMPRESSION", key: "user" },
  errors: ["RATE_LIMITED"],
});

export const recordClickContract = defineContract({
  id: "recordAdClick",
  method: "POST",
  path: "/api/v1/student/ads/clicks",
  tag: TAG,
  summary: "Catat klik iklan & ambil tautan tujuan",
  description: "Setiap klik dicatat. Ditagih maks sekali per siswa/iklan/hari (WIB); tidak ditagih (SUSPECT) bila tanpa impresi 30 menit sebelumnya atau akun siswa aktif < 7 hari. Buka targetUrl dari respons ini (null = iklan sudah tidak tayang). Token siswa lain/palsu/kedaluwarsa -> 403 AD_TOKEN_INVALID.",
  action: "ads.event",
  body: clickBody,
  response: clickResultSchema,
  rateLimit: { limiter: "AD_CLICK", key: "user" },
  errors: ["AD_TOKEN_INVALID", "AD_NOT_FOUND", "RATE_LIMITED", "CONFLICT_RETRY"],
});

export const adsStudentContracts: readonly AnyContract[] = [serveAdsContract, recordImpressionsContract, recordClickContract];
