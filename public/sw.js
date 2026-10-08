/*
 * Service worker studenthub.id: notifikasi push & klik notifikasi (N3, keputusan pemilik 2026-10-03) + halaman offline
 * aplikasi terpasang (keputusan pemilik 2026-10-08). TANPA Cache Storage: halaman offline ditulis di berkas ini dan
 * respons (berautentikasi) tidak pernah disimpan. Handler fetch hanya menyentuh navigasi GET — API, aset, dan kiriman
 * formulir langsung ke jaringan; navigation preload agar navigasi tidak menunggu service worker bangun. ES2019 polos.
 * Badge ikon aplikasi: ditulis di sini saat push tiba, dan oleh halaman setiap jumlah belum dibaca berubah.
 */
"use strict";

const API = "/api/web";
const FALLBACK = { title: "studenthub.id", body: "Ada kabar baru. Ketuk untuk membuka.", url: "/hub/notifications" };
const ICON = "/brand/app-192.png";
const BADGE_ICON = "/brand/badge-96.png";

/** Halaman offline tanpa merek (nama/logo bisa diganti super admin) dan tanpa berkas lain; terang/gelap ikut sistem. */
const OFFLINE_HTML = [
  "<!doctype html><html lang=\"id\"><head><meta charset=\"utf-8\">",
  "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><title>Sedang offline</title><style>",
  ":root{color-scheme:light dark;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}",
  "body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box;background:#fff;color:#0b1220;text-align:center}",
  "main{max-width:340px;display:flex;flex-direction:column;align-items:center;gap:12px}",
  "svg,p{color:#5b6475}h1{margin:8px 0 0;font-size:1.35rem}p{margin:0;line-height:1.5}",
  "button{margin-top:8px;min-height:48px;padding:0 28px;border:0;border-radius:8px;background:#0b1220;color:#fff;font:inherit;font-weight:700}",
  "@media (prefers-color-scheme:dark){body{background:#0b1220;color:#f1f4f9}svg,p{color:#a3acbd}button{background:#f1f4f9;color:#0b1220}}",
  "</style></head><body><main>",
  "<svg width=\"56\" height=\"56\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2-1.4M2 8.8a15 15 0 0 1 4.2-2.6M22 8.8A15 15 0 0 0 10.7 5M12 20h.01\"/></svg>",
  "<h1>Kamu sedang offline</h1><p>Periksa koneksi internet. Halaman terbuka lagi otomatis begitu tersambung.</p>",
  "<button type=\"button\" onclick=\"location.reload()\">Coba lagi</button>",
  "</main><script>addEventListener('online',function(){location.reload()})</script></body></html>",
].join("");

self.addEventListener("install", () => {
  self.skipWaiting();
});

async function enableNavigationPreload() {
  const preload = self.registration.navigationPreload;
  if (!preload) return;
  try {
    await preload.enable();
  } catch {
    // Navigation preload tidak didukung: navigasi tetap lewat fetch biasa.
  }
}

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([self.clients.claim(), enableNavigationPreload()]));
});

/** Halaman buatan SW tidak mewarisi CSP situs: kunci sendiri (hanya gaya & skrip sebaris statis di atas). */
const OFFLINE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'";

function offlinePage() {
  return new Response(OFFLINE_HTML, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": OFFLINE_CSP } });
}

/** Respons jaringan diteruskan apa adanya (termasuk redirect & galat server); hanya gagal jaringan -> halaman offline. */
async function navigate(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch {
    return offlinePage();
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(navigate(event));
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
