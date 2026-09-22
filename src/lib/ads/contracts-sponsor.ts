import { z } from "zod";
import { deletedSchema } from "@/lib/academics/schema-common";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { BANNER_MAX_BODY_BYTES, MAX_NON_ARCHIVED_ADS_PER_SPONSOR } from "./constants";
import { adSchema, bannerSchema, targetSchoolSchema, updateAdResultSchema } from "./response-schemas";
import { adIdParams, bannerUploadBody, createAdBody, ownAdsQuery, targetingSchoolsQuery, updateAdBody } from "./schemas";

/** Kontrak sponsor: banner, iklan (draft, ubah, hapus, siklus), pemilih sekolah target. Iklan sponsor lain -> 404. */
const TAG = "Iklan — Sponsor";
const UPLOAD_ERRORS = [
  "LENGTH_REQUIRED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "HEIC_NOT_SUPPORTED", "IMAGE_UNREADABLE", "SERVICE_UNAVAILABLE",
] as const;
const CONTENT_ERRORS = ["AD_LINK_INVALID", "AD_SCHEDULE_INVALID", "AD_TARGETS_INVALID", "BANNER_NOT_FOUND"] as const;

export const uploadBannerContract = defineContract({
  id: "uploadAdBanner",
  method: "POST",
  path: "/api/v1/sponsor/banners",
  tag: TAG,
  summary: "Unggah banner iklan (multipart)",
  description: "JPEG/PNG/WebP, rasio 2:1 (±2%), lebar >= 800 px, maks 5 MiB, tanpa animasi -> WebP 1200×600 tanpa EXIF. Disimpan PRIVAT (pratinjau lewat GET /files/{fileId}); salinan publik /media dibuat saat iklan disetujui. Banner yang tidak dipakai iklan dihapus otomatis setelah 24 jam. Gagal aturan -> 422 BANNER_INVALID {reason}.",
  action: "ads.own.write",
  body: bannerUploadBody,
  bodyType: "multipart",
  maxBodyBytes: BANNER_MAX_BODY_BYTES,
  response: bannerSchema,
  successStatus: 201,
  rateLimit: { limiter: "UPLOAD", key: "user" },
  errors: ["BANNER_INVALID", ...UPLOAD_ERRORS, "RATE_LIMITED", "SPONSOR_SUSPENDED"],
});

export const listOwnAdsContract = defineContract({
  id: "listOwnAds",
  method: "GET",
  path: "/api/v1/sponsor/ads",
  tag: TAG,
  summary: "Daftar iklan milik sponsor (+ status tampilan Aktif/Nonaktif)",
  action: "ads.own.read",
  query: ownAdsQuery,
  response: z.array(adSchema),
  pagination: "page",
});

export const createAdContract = defineContract({
  id: "createAd",
  method: "POST",
  path: "/api/v1/sponsor/ads",
  tag: TAG,
  summary: "Buat draf iklan",
  description: `Sponsor PENDING/APPROVED. Status DRAFT dengan cpcAmount = perkiraan CPC default. Maks ${MAX_NON_ARCHIVED_ADS_PER_SPONSOR} iklan belum diarsipkan (422 AD_LIMIT_REACHED). Host punycode diterima tetapi ditandai untuk reviewer.`,
  action: "ads.own.write",
  body: createAdBody,
  response: adSchema,
  successStatus: 201,
  errors: [...CONTENT_ERRORS, "AD_LIMIT_REACHED", "SPONSOR_SUSPENDED"],
});

export const getOwnAdContract = defineContract({
  id: "getOwnAd",
  method: "GET",
  path: "/api/v1/sponsor/ads/{id}",
  tag: TAG,
  summary: "Detail iklan milik sponsor",
  action: "ads.own.read",
  params: adIdParams,
  response: adSchema,
  errors: ["AD_NOT_FOUND"],
});

export const updateAdContract = defineContract({
  id: "updateAd",
  method: "PATCH",
  path: "/api/v1/sponsor/ads/{id}",
  tag: TAG,
  summary: "Ubah iklan",
  description: "PENDING_REVIEW terkunci (409 AD_EDIT_WHILE_PENDING; tarik dulu). ARCHIVED tidak dapat diubah. Mengubah gambar/tautan/tipe tautan/cakupan/target iklan APPROVED/PAUSED -> kembali PENDING_REVIEW (butuh sponsor APPROVED, CPC di-snapshot ulang, berhenti tayang sampai disetujui). Judul & jadwal tidak memicu review.",
  action: "ads.own.write",
  params: adIdParams,
  body: updateAdBody,
  response: updateAdResultSchema,
  errors: ["AD_NOT_FOUND", ...CONTENT_ERRORS, "AD_EDIT_WHILE_PENDING", "AD_INVALID_TRANSITION", "STATE_CONFLICT", "SPONSOR_NOT_APPROVED", "SPONSOR_SUSPENDED"],
});

export const deleteAdContract = defineContract({
  id: "deleteAd",
  method: "DELETE",
  path: "/api/v1/sponsor/ads/{id}",
  tag: TAG,
  summary: "Hapus draf iklan yang belum pernah tayang",
  description: "Selain DRAFT tanpa klik/statistik -> 409 AD_NOT_DELETABLE (arsipkan saja).",
  action: "ads.own.write",
  params: adIdParams,
  response: deletedSchema,
  errors: ["AD_NOT_FOUND", "AD_NOT_DELETABLE"],
});

const lifecycle = {
  submit: { action: "ads.own.submit", summary: "Ajukan review (DRAFT/REJECTED -> PENDING_REVIEW)", description: "Hanya sponsor APPROVED; jadwal belum berakhir. CPC default saat ini di-snapshot (harga yang akan ditagih). Super admin menerima AD_SUBMITTED." },
  withdraw: { action: "ads.own.write", summary: "Tarik pengajuan (PENDING_REVIEW -> DRAFT)", description: "Agar iklan bisa diubah sebelum ditinjau." },
  pause: { action: "ads.own.write", summary: "Jeda iklan (APPROVED -> PAUSED)", description: "Berhenti tayang; klik tidak ditagih." },
  resume: { action: "ads.own.submit", summary: "Lanjutkan iklan (PAUSED -> APPROVED)", description: "Hanya sponsor APPROVED & jadwal belum berakhir (perpanjang endAt dulu)." },
  archive: { action: "ads.own.write", summary: "Arsipkan iklan (terminal)", description: "Dari DRAFT/REJECTED/APPROVED/PAUSED. Salinan banner publik dihapus bila tak dipakai iklan aktif lain." },
} as const;

type LifecycleVerb = keyof typeof lifecycle;

function lifecycleContract<const V extends LifecycleVerb>(verb: V, id: string) {
  const spec = lifecycle[verb];
  return defineContract({
    id,
    method: "POST",
    path: `/api/v1/sponsor/ads/{id}/${verb}`,
    tag: TAG,
    summary: spec.summary,
    description: `${spec.description} Status tidak sesuai -> 409 AD_INVALID_TRANSITION.`,
    action: spec.action,
    params: adIdParams,
    response: adSchema,
    errors: ["AD_NOT_FOUND", "AD_INVALID_TRANSITION", "AD_SCHEDULE_INVALID", "SPONSOR_NOT_APPROVED", "SPONSOR_SUSPENDED"],
  });
}

export const submitAdContract = lifecycleContract("submit", "submitAd");
export const withdrawAdContract = lifecycleContract("withdraw", "withdrawAd");
export const pauseAdContract = lifecycleContract("pause", "pauseAd");
export const resumeAdContract = lifecycleContract("resume", "resumeAd");
export const archiveAdContract = lifecycleContract("archive", "archiveAd");

export const listTargetSchoolsContract = defineContract({
  id: "listAdTargetSchools",
  method: "GET",
  path: "/api/v1/sponsor/targeting/schools",
  tag: TAG,
  summary: "Pemilih sekolah untuk target iklan (sekolah aktif)",
  action: "ads.targeting.read",
  query: targetingSchoolsQuery,
  response: z.array(targetSchoolSchema),
  pagination: "page",
});

export const adsSponsorContracts: readonly AnyContract[] = [
  uploadBannerContract, listOwnAdsContract, createAdContract, getOwnAdContract, updateAdContract, deleteAdContract,
  submitAdContract, withdrawAdContract, pauseAdContract, resumeAdContract, archiveAdContract, listTargetSchoolsContract,
];
