import type { AnyContract } from "@/lib/http/contract";
import { defineContract } from "@/lib/http/contract";
import {
  inboxDetailSchema,
  inboxListSchema,
  listInboxQuerySchema,
  markReadResultSchema,
  notificationIdParams,
  readAllBodySchema,
  readAllResultSchema,
  unreadCountSchema,
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
    "Lanjutkan dengan `cursor` = `meta.nextCursor`.",
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
  description: "Dashboard web cukup polling endpoint ini tiap 30 detik. Tampilkan \"99+\" bila total > 99.",
  action: "notification.self",
  response: unreadCountSchema,
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

export const notificationsContracts: readonly AnyContract[] = [
  listNotificationsContract,
  getUnreadNotificationCountContract,
  getNotificationContract,
  markNotificationReadContract,
  markAllNotificationsReadContract,
];
