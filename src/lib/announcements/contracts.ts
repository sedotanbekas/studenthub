import { z } from "zod";
import { schoolIdQuery } from "@/lib/academics/schema-common";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import {
  announcementDetailSchema,
  announcementIdParams,
  announcementListItemSchema,
  cancelAnnouncementBody,
  createAnnouncementBody,
  deletedAnnouncementSchema,
  listAnnouncementsQuery,
  recipientPreviewBody,
  recipientPreviewSchema,
  updateAnnouncementBody,
} from "./schemas";

/** Kontrak route pengumuman admin sekolah: /school/announcements*. */
const TAG = "Pengumuman";
const SCOPE_NOTE = "SUPER_ADMIN wajib mengirim ?schoolId=. Id milik sekolah lain -> 404.";
const TARGET_NOTE =
  "Target wajib milik sekolah: kelas aktif (CLASSES) atau siswa non-DRAF (STUDENTS); id asing/tidak ada -> 422 INVALID_TARGETS dengan details.invalidIds.";
const RECIPIENT_NOTE =
  "Penerima ditentukan SAAT TERBIT: siswa AKTIF berakun aktif yang cocok audiens (CLASSES = kelas saat ini). 0 penerima -> 422 NO_RECIPIENTS. Setiap penerima mendapat notifikasi inbox ANNOUNCEMENT (+ push ke HP siswa).";

export const listAnnouncementsContract = defineContract({
  id: "listSchoolAnnouncements",
  method: "GET",
  path: "/api/v1/school/announcements",
  tag: TAG,
  summary: "Daftar pengumuman sekolah",
  description: `Terbaru dulu. q = judul memuat (wildcard diloloskan). ${SCOPE_NOTE}`,
  action: "announcements.read",
  query: listAnnouncementsQuery,
  response: z.array(announcementListItemSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const createAnnouncementContract = defineContract({
  id: "createSchoolAnnouncement",
  method: "POST",
  path: "/api/v1/school/announcements",
  tag: TAG,
  summary: "Buat pengumuman (draf, atau langsung terbit dengan publishNow)",
  description: `Kategori selain SYSTEM; judul 3–150, isi 1–5000 karakter (teks polos). ALL tanpa target; CLASSES 1–50 kelas; STUDENTS 1–500 siswa (duplikat dibuang). ${TARGET_NOTE} publishNow=true: ${RECIPIENT_NOTE} ${SCOPE_NOTE}`,
  action: "announcements.manage",
  query: schoolIdQuery,
  body: createAnnouncementBody,
  response: announcementDetailSchema,
  successStatus: 201,
  errors: ["INVALID_TARGETS", "NO_RECIPIENTS", "SCHOOL_NOT_FOUND"],
});

export const previewAnnouncementRecipientsContract = defineContract({
  id: "previewSchoolAnnouncementRecipients",
  method: "POST",
  path: "/api/v1/school/announcements/recipient-preview",
  tag: TAG,
  summary: "Pratinjau jumlah penerima sebelum terbit",
  description: `Query yang sama dengan resolusi penerima saat terbit. ${TARGET_NOTE} ${SCOPE_NOTE}`,
  action: "announcements.read",
  query: schoolIdQuery,
  body: recipientPreviewBody,
  response: recipientPreviewSchema,
  errors: ["INVALID_TARGETS", "SCHOOL_NOT_FOUND"],
});

export const getAnnouncementContract = defineContract({
  id: "getSchoolAnnouncement",
  method: "GET",
  path: "/api/v1/school/announcements/{id}",
  tag: TAG,
  summary: "Detail pengumuman + target + statistik baca",
  description: SCOPE_NOTE,
  action: "announcements.read",
  params: announcementIdParams,
  query: schoolIdQuery,
  response: announcementDetailSchema,
});

export const updateAnnouncementContract = defineContract({
  id: "updateSchoolAnnouncement",
  method: "PATCH",
  path: "/api/v1/school/announcements/{id}",
  tag: TAG,
  summary: "Ubah draf pengumuman",
  description: `Hanya DRAF (terbit/ditarik -> 422 ANNOUNCEMENT_NOT_EDITABLE). audience + classIds/studentIds dikirim sebagai satu blok dan MENGGANTI seluruh target. ${TARGET_NOTE} ${SCOPE_NOTE}`,
  action: "announcements.manage",
  params: announcementIdParams,
  query: schoolIdQuery,
  body: updateAnnouncementBody,
  response: announcementDetailSchema,
  errors: ["ANNOUNCEMENT_NOT_EDITABLE", "INVALID_TARGETS", "STATE_CONFLICT"],
});

export const deleteAnnouncementContract = defineContract({
  id: "deleteSchoolAnnouncement",
  method: "DELETE",
  path: "/api/v1/school/announcements/{id}",
  tag: TAG,
  summary: "Hapus draf pengumuman",
  description: `Hapus permanen; hanya DRAF (selain itu 409 ANNOUNCEMENT_NOT_DRAFT — pengumuman terbit ditarik lewat /cancel). ${SCOPE_NOTE}`,
  action: "announcements.manage",
  params: announcementIdParams,
  query: schoolIdQuery,
  response: deletedAnnouncementSchema,
  errors: ["ANNOUNCEMENT_NOT_DRAFT", "STATE_CONFLICT"],
});

export const publishAnnouncementContract = defineContract({
  id: "publishSchoolAnnouncement",
  method: "POST",
  path: "/api/v1/school/announcements/{id}/publish",
  tag: TAG,
  summary: "Terbitkan draf pengumuman",
  description: `DRAF -> TERBIT (selain draf -> 409 INVALID_STATUS_TRANSITION; terbit bersamaan hanya satu yang berhasil). ${RECIPIENT_NOTE} Pengumuman terbit tidak dapat diubah. Tanpa body. ${SCOPE_NOTE}`,
  action: "announcements.manage",
  params: announcementIdParams,
  query: schoolIdQuery,
  response: announcementDetailSchema,
  errors: ["NO_RECIPIENTS", "INVALID_STATUS_TRANSITION", "STATE_CONFLICT"],
});

export const cancelAnnouncementContract = defineContract({
  id: "cancelSchoolAnnouncement",
  method: "POST",
  path: "/api/v1/school/announcements/{id}/cancel",
  tag: TAG,
  summary: "Batalkan draf / tarik pengumuman terbit",
  description: `DRAF -> DIBATALKAN (tanpa notifikasi). TERBIT -> DITARIK: cancelledAt diisi dan SELURUH notifikasi pengumuman ini dihapus dari inbox penerima (push yang belum terkirim ikut batal). Alasan dicatat di audit. Sudah dibatalkan -> 409 INVALID_STATUS_TRANSITION. ${SCOPE_NOTE}`,
  action: "announcements.manage",
  params: announcementIdParams,
  query: schoolIdQuery,
  body: cancelAnnouncementBody,
  response: announcementDetailSchema,
  errors: ["INVALID_STATUS_TRANSITION", "STATE_CONFLICT"],
});

/** Kontrak route domain announcements. */
export const announcementsContracts: readonly AnyContract[] = [
  listAnnouncementsContract,
  createAnnouncementContract,
  previewAnnouncementRecipientsContract,
  getAnnouncementContract,
  updateAnnouncementContract,
  deleteAnnouncementContract,
  publishAnnouncementContract,
  cancelAnnouncementContract,
];
