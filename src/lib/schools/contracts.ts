import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import {
  createSchoolBody,
  deactivateSchoolBody,
  deactivateSchoolResult,
  idParams,
  listSchoolsQuery,
  platformSchoolDetailSchema,
  reactivateSchoolResult,
  schoolListItemSchema,
  schoolProfileSchema,
  schoolSchema,
  schoolScopeQuery,
  updateSchoolBody,
  updateSchoolSettingsBody,
} from "./schemas";

/** Kontrak route domain sekolah: /platform/schools* (SUPER_ADMIN) dan /school/profile|settings. */
const PLATFORM_TAG = "Super Admin - Sekolah";
const SCHOOL_TAG = "Sekolah - Profil & Pengaturan";
const CONFIG_ERRORS = ["SCHOOL_CONFIG_INVALID", "CITY_NOT_IN_PROVINCE", "NPSN_TAKEN"];

export const listPlatformSchoolsContract = defineContract({
  id: "listPlatformSchools",
  method: "GET",
  path: "/api/v1/platform/schools",
  tag: PLATFORM_TAG,
  summary: "Daftar & cari sekolah",
  description: "Filter nama/awalan NPSN (`q`), provinsi, kabupaten/kota, status aktif. Setiap baris memuat jumlah siswa aktif.",
  action: "schools.manage",
  query: listSchoolsQuery,
  response: z.array(schoolListItemSchema),
  pagination: "page",
});

export const createPlatformSchoolContract = defineContract({
  id: "createPlatformSchool",
  method: "POST",
  path: "/api/v1/platform/schools",
  tag: PLATFORM_TAG,
  summary: "Buat sekolah baru (lokasi, geofence, zona waktu, jadwal, rekening SPP)",
  description: [
    "Kolom jadwal/radius yang tidak dikirim memakai default (buka 06:00, masuk 07:00, toleransi 15 menit, tutup 10:00, akhir hari 15:00,",
    "Senin-Jumat, radius 150 m). Kabupaten/kota harus milik provinsi yang dipilih. Aturan konfigurasi dilanggar -> 422",
    "`SCHOOL_CONFIG_INVALID` dengan `details.errors[]` per kolom; NPSN ganda -> 409 `NPSN_TAKEN`.",
  ].join(" "),
  action: "schools.manage",
  body: createSchoolBody,
  response: platformSchoolDetailSchema,
  successStatus: 201,
  errors: CONFIG_ERRORS,
});

export const getPlatformSchoolContract = defineContract({
  id: "getPlatformSchool",
  method: "GET",
  path: "/api/v1/platform/schools/{id}",
  tag: PLATFORM_TAG,
  summary: "Detail sekolah + jumlah siswa per status & jumlah admin",
  action: "schools.manage",
  params: idParams,
  response: platformSchoolDetailSchema,
});

export const updatePlatformSchoolContract = defineContract({
  id: "updatePlatformSchool",
  method: "PATCH",
  path: "/api/v1/platform/schools/{id}",
  tag: PLATFORM_TAG,
  summary: "Ubah data sekolah apa pun (termasuk lokasi, geofence, zona waktu, rekening)",
  description: [
    "Patch digabung dengan data sekarang lalu divalidasi UTUH (422 `SCHOOL_CONFIG_INVALID`). Perubahan lintang/bujur/radius/zona",
    "waktu mengisi `geofenceUpdatedAt`; perubahan rekening mengisi `bankChangedAt`. Setiap perubahan diaudit (before/after) dan",
    "diberitahukan ke semua admin sekolah aktif (notifikasi `SCHOOL_SETTINGS_CHANGED`). Baris absensi yang sudah ada tidak ditulis ulang.",
    "Kirim `null` untuk mengosongkan kolom opsional (rekening harus dikosongkan ketiganya).",
  ].join(" "),
  action: "schools.manage",
  params: idParams,
  body: updateSchoolBody,
  response: platformSchoolDetailSchema,
  errors: CONFIG_ERRORS,
});

export const deactivatePlatformSchoolContract = defineContract({
  id: "deactivatePlatformSchool",
  method: "POST",
  path: "/api/v1/platform/schools/{id}/deactivate",
  tag: PLATFORM_TAG,
  summary: "Nonaktifkan sekolah (semua sesi pengguna sekolah dicabut)",
  description: "Admin & siswa sekolah langsung mendapat 401 pada request berikutnya. Alasan dicatat di audit.",
  action: "schools.manage",
  params: idParams,
  body: deactivateSchoolBody,
  response: deactivateSchoolResult,
  errors: ["SCHOOL_ALREADY_INACTIVE"],
});

export const reactivatePlatformSchoolContract = defineContract({
  id: "reactivatePlatformSchool",
  method: "POST",
  path: "/api/v1/platform/schools/{id}/reactivate",
  tag: PLATFORM_TAG,
  summary: "Aktifkan kembali sekolah",
  description: "Pengguna sekolah perlu login ulang (sesi lama sudah dicabut saat penonaktifan).",
  action: "schools.manage",
  params: idParams,
  response: reactivateSchoolResult,
  errors: ["SCHOOL_ALREADY_ACTIVE"],
});

export const getSchoolProfileContract = defineContract({
  id: "getSchoolProfile",
  method: "GET",
  path: "/api/v1/school/profile",
  tag: SCHOOL_TAG,
  summary: "Profil sekolah sendiri + semester aktif + checklist onboarding",
  description: "SUPER_ADMIN wajib `?schoolId=`. Jadwal disertakan dalam menit lokal dan format HH:mm (`schedule`).",
  action: "schools.profile.read",
  query: schoolScopeQuery,
  response: schoolProfileSchema,
});

export const updateSchoolSettingsContract = defineContract({
  id: "updateSchoolSettings",
  method: "PATCH",
  path: "/api/v1/school/settings",
  tag: SCHOOL_TAG,
  summary: "Ubah jadwal absensi & hari sekolah",
  description: [
    "Hanya `checkInOpenMinute`, `startMinute`, `lateToleranceMinutes`, `checkInCloseMinute`, `dayEndMinute`, `schoolDaysMask`.",
    "Lokasi, geofence, zona waktu, dan rekening SPP HANYA dapat diubah super admin (kunci lain -> 400 `VALIDATION_FAILED`).",
    "Hasil merge harus memenuhi 0 <= buka < masuk <= tutup <= akhir hari < 1440 dan masuk + toleransi < tutup (422",
    "`SCHOOL_CONFIG_INVALID`). Baris absensi yang SUDAH tercatat tidak ditulis ulang; aturan baru berlaku untuk hari/check-in berikutnya.",
    "Diaudit sebagai `school.settings_update`.",
  ].join(" "),
  action: "schools.settings.update",
  query: schoolScopeQuery,
  body: updateSchoolSettingsBody,
  response: schoolSchema,
  errors: ["SCHOOL_CONFIG_INVALID"],
});

export const schoolsContracts: readonly AnyContract[] = [
  listPlatformSchoolsContract,
  createPlatformSchoolContract,
  getPlatformSchoolContract,
  updatePlatformSchoolContract,
  deactivatePlatformSchoolContract,
  reactivatePlatformSchoolContract,
  getSchoolProfileContract,
  updateSchoolSettingsContract,
];
