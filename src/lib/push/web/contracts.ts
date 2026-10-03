import type { AnyContract } from "@/lib/http/contract";
import { defineContract } from "@/lib/http/contract";
import { upsertWebPushBody, webPushStatusSchema, webPushSubscribedSchema } from "./schemas";

/** Kontrak Web Push (N3): langganan notifikasi browser untuk sesi WEB pemanggil (semua peran). */
const TAG = "Notifikasi";
const PATH = "/api/v1/me/web-push";
const NOTE =
  "Push dikirim ke semua peran lewat outbox yang sama dengan Expo; tautan klik = bagian hub + `?notif=<id>`. Satu langganan per sesi web; " +
  "langganan sesi yang dicabut (logout, ganti sandi, sesi digantikan, sekolah dinonaktifkan) ikut dihapus, dan endpoint yang dijawab 404/410 " +
  "oleh push service dihapus otomatis. iPhone: iOS 16.4+ dan dibuka dari ikon layar utama.";

export const getMyWebPushStatusContract = defineContract({
  id: "getMyWebPushStatus",
  method: "GET",
  path: PATH,
  tag: TAG,
  summary: "Status notifikasi HP (Web Push) di sesi ini",
  description: `enabled=false bila server belum punya kunci VAPID (tombol disembunyikan). ${NOTE}`,
  action: "notification.push",
  response: webPushStatusSchema,
});

export const upsertMyWebPushSubscriptionContract = defineContract({
  id: "upsertMyWebPushSubscription",
  method: "PUT",
  path: `${PATH}/subscription`,
  tag: TAG,
  summary: "Simpan langganan Web Push browser ini (PushSubscription.toJSON())",
  description:
    "Idempoten; endpoint baru di sesi yang sama menggantikan yang lama; endpoint milik sesi/akun lain (ganti akun di browser yang sama) " +
    "dipindah ke sesi ini. Hanya sesi WEB (422 WEB_PUSH_APP_SESSION), server harus punya kunci (422 WEB_PUSH_DISABLED), endpoint harus push " +
    "service yang dikenal & kunci p256dh titik P-256 sah (422 WEB_PUSH_ENDPOINT_INVALID). Maks 20 per 10 menit per akun. " + NOTE,
  action: "notification.push",
  body: upsertWebPushBody,
  response: webPushSubscribedSchema,
  rateLimit: { limiter: "WEB_PUSH", key: "user" },
  errors: ["WEB_PUSH_DISABLED", "WEB_PUSH_APP_SESSION", "WEB_PUSH_ENDPOINT_INVALID", "SESSION_INVALID", "RATE_LIMITED"],
});

export const removeMyWebPushSubscriptionContract = defineContract({
  id: "removeMyWebPushSubscription",
  method: "DELETE",
  path: `${PATH}/subscription`,
  tag: TAG,
  summary: "Matikan notifikasi HP di sesi ini",
  description: "Idempoten (tanpa langganan pun 200). Browser sebaiknya juga memanggil PushSubscription.unsubscribe().",
  action: "notification.push",
  response: webPushSubscribedSchema,
});

export const webPushContracts: readonly AnyContract[] = [getMyWebPushStatusContract, upsertMyWebPushSubscriptionContract, removeMyWebPushSubscriptionContract];
