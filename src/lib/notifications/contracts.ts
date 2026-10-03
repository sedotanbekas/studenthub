import type { AnyContract } from "@/lib/http/contract";
import { defineContract } from "@/lib/http/contract";
import {
  inboxDetailSchema,
  inboxListSchema,
  listInboxQuerySchema,
  markReadResultSchema,
  notificationIdParams,
  notificationPreferencesSchema,
  readAllBodySchema,
  readAllResultSchema,
  unreadCountSchema,
  updateNotificationPreferencesBody,
} from "./schemas";

/** Kontrak route inbox notifikasi (semua peran, aksi inti `notification.self`). */
const TAG = "Notifikasi";

export const listNotificationsContract = defineContract({
  id: "listNotifications",
  method: "GET",
  path: "/api/v1/notifications",
  tag: TAG,
  summary: "Inbox notifikasi milik pengguna (feed cursor)",
  description:
    "Urut terbaru dulu (createdAt desc, id desc). Beranda \"Pemberitahuan\" memakai kind=announcement; tab Notifikasi memakai kind=all. " +
    "Lanjutkan dengan `cursor` = `meta.nextCursor`. Notifikasi absensi (kategori ATTENDANCE): `data.screen` attendance-alpha " +
    "(id = tanggal Alpa; tawarkan ajukan izin/sakit selama tanggal >= hari ini - 7), leave-request (id = pengajuan), attendance-day " +
    "(id = tanggal, rekap admin).",
  action: "notification.self",
  query: listInboxQuerySchema,
  response: inboxListSchema,
  pagination: "cursor",
  errors: ["INVALID_CURSOR"],
});

export const getUnreadNotificationCountContract = defineContract({
  id: "getUnreadNotificationCount",
  method: "GET",
  path: "/api/v1/notifications/unread-count",
  tag: TAG,
  summary: "Jumlah notifikasi belum dibaca (badge & polling dashboard)",
  description:
    "Dashboard web memakai satu poller per tab: staf & sponsor tiap 30 detik, siswa tiap 60 detik, hanya saat halaman terlihat " +
    "(jitter ±10%, backoff s.d. 5 menit), segera setelah tandai dibaca. Tampilkan \"99+\" bila total > 99. Respons sukses tidak ditulis ke log request.",
  action: "notification.self",
  response: unreadCountSchema,
  quietSuccessLog: true,
});

export const getNotificationContract = defineContract({
  id: "getNotification",
  method: "GET",
  path: "/api/v1/notifications/{id}",
  tag: TAG,
  summary: "Detail notifikasi (termasuk isi lengkap pengumuman)",
  description: "Tidak menandai dibaca. Notifikasi milik pengguna lain atau pengumuman yang sudah ditarik -> 404.",
  action: "notification.self",
  params: notificationIdParams,
  response: inboxDetailSchema,
});

export const markNotificationReadContract = defineContract({
  id: "markNotificationRead",
  method: "POST",
  path: "/api/v1/notifications/{id}/read",
  tag: TAG,
  summary: "Tandai satu notifikasi sudah dibaca (aman diulang)",
  description: "Mengulang panggilan mengembalikan readAt yang sama. Notifikasi milik pengguna lain -> 404.",
  action: "notification.self",
  params: notificationIdParams,
  response: markReadResultSchema,
});

export const markAllNotificationsReadContract = defineContract({
  id: "markAllNotificationsRead",
  method: "POST",
  path: "/api/v1/notifications/read-all",
  tag: TAG,
  summary: "Tandai semua notifikasi sudah dibaca",
  description:
    "Kirim `before` = waktu daftar diambil agar item yang datang sesudahnya tidak ikut ditandai (tidak pernah melewati waktu server). " +
    "Body boleh `{}`.",
  action: "notification.self",
  body: readAllBodySchema,
  response: readAllResultSchema,
});

const PREFS_NOTE =
  "Hanya menyaring siaran ke admin sekolah (Keuangan: bukti transfer SPP; Kesiswaan: pengajuan izin/sakit; Kehadiran: rekap harian) " +
  "saat notifikasi DITULIS — " +
  "tidak berlaku mundur. Notifikasi pribadi dan kategori Sistem selalu dikirim; bila semua admin mematikan satu kategori, admin utama tetap menerimanya.";

export const getMyNotificationPreferencesContract = defineContract({
  id: "getMyNotificationPreferences",
  method: "GET",
  path: "/api/v1/me/notification-preferences",
  tag: TAG,
  summary: "Kabar sekolah yang dikirim ke akun admin ini",
  description: PREFS_NOTE,
  action: "notification.preferences",
  response: notificationPreferencesSchema,
});

export const updateMyNotificationPreferencesContract = defineContract({
  id: "updateMyNotificationPreferences",
  method: "PUT",
  path: "/api/v1/me/notification-preferences",
  tag: TAG,
  summary: "Atur kabar sekolah yang dikirim ke akun admin ini",
  description: `${PREFS_NOTE} Set sama -> tanpa perubahan & tanpa audit; selain itu diaudit user.notification_mutes.`,
  action: "notification.preferences",
  body: updateNotificationPreferencesBody,
  response: notificationPreferencesSchema,
});

export const notificationsContracts: readonly AnyContract[] = [
  listNotificationsContract,
  getUnreadNotificationCountContract,
  getNotificationContract,
  markNotificationReadContract,
  markAllNotificationsReadContract,
  getMyNotificationPreferencesContract,
  updateMyNotificationPreferencesContract,
];
