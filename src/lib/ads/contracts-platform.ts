import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { reviewAdSchema } from "./response-schemas";
import { adIdParams, approveAdBody, platformAdsQuery, rejectAdBody, takedownAdBody } from "./schemas";

/** Kontrak super admin: antrean review iklan, setujui/tolak (CAS submittedAt), takedown, daftar iklan platform. */
const TAG = "Iklan — Review";

export const listPlatformAdsContract = defineContract({
  id: "listPlatformAds",
  method: "GET",
  path: "/api/v1/platform/ads",
  tag: TAG,
  summary: "Antrean review / daftar iklan platform",
  description: "Default status PENDING_REVIEW (submittedAt terlama dulu). urlHost & isPunycodeHost membantu mendeteksi domain homograf.",
  action: "ads.review",
  query: platformAdsQuery,
  response: z.array(reviewAdSchema),
  pagination: "page",
});

export const getPlatformAdContract = defineContract({
  id: "getPlatformAd",
  method: "GET",
  path: "/api/v1/platform/ads/{id}",
  tag: TAG,
  summary: "Detail iklan untuk review",
  description: "Banner privat bisa dipratinjau lewat GET /files/{imageFileId}.",
  action: "ads.review",
  params: adIdParams,
  response: reviewAdSchema,
  errors: ["AD_NOT_FOUND"],
});

const REVIEW_ERRORS = ["AD_NOT_FOUND", "AD_INVALID_TRANSITION", "AD_REVIEW_STALE"] as const;

export const approveAdContract = defineContract({
  id: "approveAd",
  method: "POST",
  path: "/api/v1/platform/ads/{id}/approve",
  tag: TAG,
  summary: "Setujui iklan (PENDING_REVIEW -> APPROVED)",
  description: "submittedAt = versi yang ditinjau (berbeda -> 409 AD_REVIEW_STALE). Sponsor harus APPROVED dan jadwal belum berakhir. Banner disalin ke bucket publik /media. Sponsor menerima AD_APPROVED.",
  action: "ads.review",
  params: adIdParams,
  body: approveAdBody,
  response: reviewAdSchema,
  errors: [...REVIEW_ERRORS, "AD_SCHEDULE_INVALID"],
});

export const rejectAdContract = defineContract({
  id: "rejectAd",
  method: "POST",
  path: "/api/v1/platform/ads/{id}/reject",
  tag: TAG,
  summary: "Tolak iklan (PENDING_REVIEW -> REJECTED, alasan wajib)",
  action: "ads.review",
  params: adIdParams,
  body: rejectAdBody,
  response: reviewAdSchema,
  errors: REVIEW_ERRORS,
});

export const takedownAdContract = defineContract({
  id: "takedownAd",
  method: "POST",
  path: "/api/v1/platform/ads/{id}/takedown",
  tag: TAG,
  summary: "Turunkan iklan (APPROVED/PAUSED/PENDING_REVIEW -> REJECTED)",
  description: "Berlaku pada klik berikutnya (targetUrl null, tidak ditagih). Salinan banner publik dihapus bila tak dipakai iklan aktif lain. Diaudit.",
  action: "ads.review",
  params: adIdParams,
  body: takedownAdBody,
  response: reviewAdSchema,
  errors: ["AD_NOT_FOUND", "AD_INVALID_TRANSITION"],
});

export const adsPlatformContracts: readonly AnyContract[] = [
  listPlatformAdsContract, getPlatformAdContract, approveAdContract, rejectAdContract, takedownAdContract,
];
