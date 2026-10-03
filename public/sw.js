/*
 * Service worker studenthub.id (N3, keputusan pemilik 2026-10-03). HANYA notifikasi push & klik notifikasi:
 * TANPA cache dan TANPA handler fetch (respons berautentikasi tidak pernah disimpan). ES2019 polos.
 * Badge ikon aplikasi: ditulis di sini saat push tiba, dan oleh halaman setiap jumlah belum dibaca berubah.
 */
"use strict";

const API = "/api/web";
const FALLBACK = { title: "studenthub.id", body: "Ada kabar baru. Ketuk untuk membuka.", url: "/hub/notifications" };
const ICON = "/brand/app-192.png";
const BADGE_ICON = "/brand/badge-96.png";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function parsePayload(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === "string" && typeof data.body === "string") return data;
  } catch {
    // Payload rusak -> notifikasi cadangan.
  }
  return null;
}

/** Hanya tautan /hub di origin ini; selain itu -> /hub. */
function safeUrl(url) {
  try {
    const target = new URL(String(url || ""), self.location.origin);
    if (target.origin === self.location.origin && (target.pathname === "/hub" || target.pathname.startsWith("/hub/"))) return target.pathname + target.search;
  } catch {
    // URL tidak sah.
  }
  return "/hub";
}

async function updateBadge(badge) {
  const nav = self.navigator;
  if (typeof badge !== "number" || !nav || typeof nav.setAppBadge !== "function") return;
  try {
    if (badge > 0) await nav.setAppBadge(badge);
    else await nav.clearAppBadge();
  } catch {
    // Badge tidak didukung.
  }
}

async function windowClients() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

async function tellWindows(message) {
  for (const client of await windowClients()) client.postMessage(message);
}

self.addEventListener("push", (event) => {
  const data = parsePayload(event);
  const payload = data || FALLBACK;
  const options = {
    body: payload.body,
    icon: (data && data.icon) || ICON,
    badge: (data && data.badgeIcon) || BADGE_ICON,
    data: { url: safeUrl(payload.url) },
  };
  if (data && data.tag) options.tag = data.tag;
  // iOS mencabut langganan yang menerima push senyap: notifikasi SELALU ditampilkan.
  event.waitUntil(Promise.all([
    self.registration.showNotification(payload.title, options),
    updateBadge(data ? data.badge : null),
    tellWindows({ type: "studenthub:push" }),
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await windowClients();
    // Hanya jendela /hub yang mendengarkan pesan navigasi; beranda/dokumen tidak dipakai -> jendela baru.
    const target = windows.find((client) => new URL(client.url).pathname.startsWith("/hub"));
    if (target) {
      // Tanpa navigate(): butuh kontrol SW & memuat ulang halaman. Halaman berpindah sendiri lewat router.
      await target.focus();
      target.postMessage({ type: "studenthub:navigate", url });
      return;
    }
    await self.clients.openWindow(url);
  })());
});

function base64UrlToBytes(value) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "===".slice((base64.length + 3) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function serverKey(oldSubscription) {
  const known = oldSubscription && oldSubscription.options && oldSubscription.options.applicationServerKey;
  if (known) return known;
  const response = await fetch(API + "/me/web-push", { credentials: "include" });
  if (!response.ok) return null;
  const body = await response.json();
  return body && body.data && body.data.publicKey ? base64UrlToBytes(body.data.publicKey) : null;
}

async function putSubscription(subscription) {
  const init = { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(subscription.toJSON()) };
  let response = await fetch(API + "/me/web-push/subscription", init);
  if (response.status === 401) {
    const refreshed = await fetch(API + "/auth/refresh", { method: "POST", credentials: "include" });
    if (refreshed.ok) response = await fetch(API + "/me/web-push/subscription", init);
  }
  return response.ok;
}

async function resubscribe(oldSubscription) {
  const applicationServerKey = await serverKey(oldSubscription);
  if (!applicationServerKey) return;
  const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await putSubscription(subscription);
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event.oldSubscription).catch(() => undefined));
});
