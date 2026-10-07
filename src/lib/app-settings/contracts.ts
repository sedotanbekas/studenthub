import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { LOGO_MAX_INPUT_BYTES } from "./rules";
import { appSettingsSchema, brandingSchema, logoQuery, logoUploadBody, updateAppSettingsBody } from "./schemas";

/** Kontrak identitas aplikasi (menu Pengaturan aplikasi, 2026-10-07): baca publik + kelola super admin. */
const TAG = "Pengaturan Aplikasi";
const UPLOAD_ERRORS = ["LENGTH_REQUIRED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "HEIC_NOT_SUPPORTED", "IMAGE_UNREADABLE"] as const;
/** Ruang header multipart di atas batas berkas 2 MB. */
const LOGO_MAX_BODY_BYTES = LOGO_MAX_INPUT_BYTES + 64 * 1024;

export const getBrandingContract = defineContract({
  id: "getAppBranding",
  method: "GET",
  path: "/api/v1/app/branding",
  tag: TAG,
  summary: "Nama & logo aplikasi (publik)",
  description: "Dipakai halaman masuk dan aplikasi HP sebelum login. logoUrl null = pakai logo bawaan.",
  action: "public",
  response: brandingSchema,
});

export const getLogoContract = defineContract({
  id: "getAppLogo",
  method: "GET",
  path: "/api/v1/app/logo",
  tag: TAG,
  summary: "Gambar logo aplikasi (publik, WebP)",
  description: "Byte logo unggahan super admin, Cache-Control public 1 hari (URL dari /app/branding berversi ?v=). Belum ada logo -> 404 LOGO_NOT_FOUND.",
  action: "public",
  query: logoQuery,
  response: z.unknown(),
  binary: true,
  binaryMediaTypes: ["image/webp"],
  errors: ["LOGO_NOT_FOUND"],
});

export const getAppSettingsContract = defineContract({
  id: "getAppSettings",
  method: "GET",
  path: "/api/v1/platform/app-settings",
  tag: TAG,
  summary: "Pengaturan identitas aplikasi (nama & logo)",
  action: "app.settings",
  response: appSettingsSchema,
});

export const updateAppSettingsContract = defineContract({
  id: "updateAppSettings",
  method: "PATCH",
  path: "/api/v1/platform/app-settings",
  tag: TAG,
  summary: "Ubah nama aplikasi",
  description: "Diaudit. Berlaku langsung di sidebar, halaman masuk, splash, judul tab, dan manifest PWA.",
  action: "app.settings",
  body: updateAppSettingsBody,
  response: appSettingsSchema,
});

export const uploadAppLogoContract = defineContract({
  id: "uploadAppLogo",
  method: "POST",
  path: "/api/v1/platform/app-settings/logo",
  tag: TAG,
  summary: "Unggah logo aplikasi (multipart)",
  description: "JPEG/PNG/WebP statis, sisi terpendek >= 64 px, maks 2 MB -> WebP <= 256 px tanpa EXIF (transparansi dipertahankan). Menggantikan logo sebelumnya; diaudit. Ikon PWA/favicon tetap bawaan. Gagal aturan -> 422 LOGO_INVALID {reason}.",
  action: "app.settings",
  body: logoUploadBody,
  bodyType: "multipart",
  maxBodyBytes: LOGO_MAX_BODY_BYTES,
  response: appSettingsSchema,
  rateLimit: { limiter: "UPLOAD", key: "user" },
  errors: ["LOGO_INVALID", ...UPLOAD_ERRORS, "RATE_LIMITED"],
});

export const removeAppLogoContract = defineContract({
  id: "removeAppLogo",
  method: "DELETE",
  path: "/api/v1/platform/app-settings/logo",
  tag: TAG,
  summary: "Hapus logo unggahan (kembali ke logo bawaan)",
  description: "Diaudit.",
  action: "app.settings",
  response: appSettingsSchema,
});

export const appSettingsContracts: readonly AnyContract[] = [
  getBrandingContract, getLogoContract, getAppSettingsContract, updateAppSettingsContract, uploadAppLogoContract, removeAppLogoContract,
];
