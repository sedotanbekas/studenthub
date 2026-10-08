import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";

/** public/sw.js dijalankan di node:vm dengan `self` tiruan (N3). */
const SOURCE = readFileSync(join(process.cwd(), "public/sw.js"), "utf8");
const ORIGIN = "https://studenthub.id";

interface FakeClient { url: string; focused: boolean; messages: unknown[]; focus(): Promise<void>; postMessage(m: unknown): void }
type Handler = (event: Record<string, unknown>) => void;

function client(url: string): FakeClient {
  return { url, focused: false, messages: [], async focus() { this.focused = true; }, postMessage(m) { this.messages.push(m); } };
}

function worker(options: { clients?: FakeClient[]; noPreload?: boolean; fetch?: (url: string, init?: { method?: string }) => Promise<unknown> } = {}) {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const badges: Array<number | "clear"> = [];
  const opened: string[] = [];
  const subscribed: unknown[] = [];
  const windows = options.clients ?? [];
  let preloadEnables = 0;
  const self = {
    location: { origin: ORIGIN },
    navigator: { async setAppBadge(n: number) { badges.push(n); }, async clearAppBadge() { badges.push("clear"); } },
    registration: {
      async showNotification(title: string, opts: Record<string, unknown>) { shown.push({ title, options: opts }); },
      pushManager: { async subscribe(opts: unknown) { subscribed.push(opts); return { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/baru", keys: { p256dh: "p", auth: "a" } }) }; } },
      navigationPreload: options.noPreload ? undefined : { async enable() { preloadEnables += 1; } },
    },
    clients: { async matchAll() { return windows; }, async openWindow(url: string) { opened.push(url); }, async claim() {} },
    skipWaiting() {},
    addEventListener(type: string, handler: Handler) { handlers.set(type, handler); },
  };
  const context = createContext({ self, URL, atob, Uint8Array, Promise, JSON, String, Response, fetch: options.fetch ?? (async () => ({ ok: false, status: 500, json: async () => null })) });
  runInContext(SOURCE, context);
  async function dispatch(type: string, extra: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...extra, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }
  /** Event fetch: undefined = tidak memanggil respondWith (browser mengambil sendiri). */
  async function fetchEvent(request: { mode: string; method: string; url: string }, preloadResponse: Promise<unknown> = Promise.resolve(undefined)): Promise<unknown> {
    let responded: Promise<unknown> | undefined;
    handlers.get("fetch")?.({ request, preloadResponse, respondWith: (p: Promise<unknown>) => { responded = p; } });
    return responded === undefined ? undefined : await responded;
  }
  return { dispatch, fetchEvent, shown, badges, opened, subscribed, handlers, preloadEnables: () => preloadEnables };
}

/** Objek dari realm vm punya prototipe lain: bandingkan bentuk JSON-nya. */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const pushEvent = (payload: unknown) => ({ data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } });

test("push -> notifikasi selalu tampil, badge di-set / dihapus, jendela diberi tahu", async () => {
  const win = client(`${ORIGIN}/hub`);
  const sw = worker({ clients: [win] });
  await sw.dispatch("push", pushEvent({ notificationId: "n1", title: "Tagihan baru", body: "SPP Oktober", url: "/hub/my-billing?notif=n1", tag: "n-n1", badge: 3, icon: "/brand/app-192.png", badgeIcon: "/brand/badge-96.png" }));
  assert.equal(sw.shown[0]?.title, "Tagihan baru");
  assert.deepEqual([sw.shown[0]?.options.body, sw.shown[0]?.options.tag, (sw.shown[0]?.options.data as { url: string }).url], ["SPP Oktober", "n-n1", "/hub/my-billing?notif=n1"]);
  assert.deepEqual(sw.badges, [3]);
  assert.deepEqual(plain(win.messages), [{ type: "studenthub:push" }]);
  await sw.dispatch("push", pushEvent({ notificationId: "n2", title: "t", body: "b", url: "/hub", badge: 0 }));
  assert.deepEqual(sw.badges, [3, "clear"]);
});

test("payload rusak / tanpa payload -> notifikasi cadangan; url asing -> /hub", async () => {
  const sw = worker();
  await sw.dispatch("push", pushEvent("{rusak"));
  await sw.dispatch("push", { data: null });
  await sw.dispatch("push", pushEvent({ title: "t", body: "b", url: "https://evil.example/hub" }));
  assert.deepEqual(sw.shown.slice(0, 2).map((s) => [s.title, (s.options.data as { url: string }).url]), [["studenthub.id", "/hub/notifications"], ["studenthub.id", "/hub/notifications"]]);
  assert.equal((sw.shown[2]?.options.data as { url: string }).url, "/hub");
  assert.deepEqual(sw.badges, [], "tanpa angka badge -> tidak diubah");
});

test("klik: jendela /hub difokuskan & diberi pesan navigasi; tanpa jendela -> openWindow; url asing -> /hub", async () => {
  const other = client(`${ORIGIN}/`);
  const hub = client(`${ORIGIN}/hub/notifications`);
  const sw = worker({ clients: [other, hub] });
  let closed = false;
  await sw.dispatch("notificationclick", { notification: { close: () => { closed = true; }, data: { url: "/hub/billing?notif=n9" } } });
  assert.equal(closed, true);
  assert.equal(hub.focused, true);
  assert.deepEqual(plain(hub.messages), [{ type: "studenthub:navigate", url: "/hub/billing?notif=n9" }]);
  const empty = worker();
  await empty.dispatch("notificationclick", { notification: { close() {}, data: { url: "https://evil.example/x" } } });
  assert.deepEqual(empty.opened, ["/hub"]);
});

test("klik tanpa jendela /hub (hanya beranda/dokumen): jendela lain tidak dipakai, tujuan dibuka di jendela baru", async () => {
  const landing = client(`${ORIGIN}/`);
  const docs = client(`${ORIGIN}/docs`);
  const sw = worker({ clients: [landing, docs] });
  await sw.dispatch("notificationclick", { notification: { close() {}, data: { url: "/hub/my-attendance?absen=1&notif=n1" } } });
  assert.deepEqual(sw.opened, ["/hub/my-attendance?absen=1&notif=n1"]);
  assert.deepEqual(plain([landing.messages, docs.messages]), [[], []]);
});

test("pushsubscriptionchange -> langganan ulang lalu PUT; 401 -> refresh -> PUT sekali lagi", async () => {
  const calls: string[] = [];
  let puts = 0;
  const sw = worker({
    fetch: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/me/web-push") && !init?.method) return { ok: true, status: 200, json: async () => ({ data: { publicKey: "BAEC" } }) };
      if (url.endsWith("/subscription")) { puts += 1; return { ok: puts > 1, status: puts > 1 ? 200 : 401, json: async () => null }; }
      return { ok: true, status: 200, json: async () => null };
    },
  });
  await sw.dispatch("pushsubscriptionchange", { oldSubscription: null });
  assert.equal(sw.subscribed.length, 1);
  assert.deepEqual(calls, ["GET /api/web/me/web-push", "PUT /api/web/me/web-push/subscription", "POST /api/web/auth/refresh", "PUT /api/web/me/web-push/subscription"]);
  const failing = worker({ fetch: async () => { throw new Error("offline"); } });
  await failing.dispatch("pushsubscriptionchange", { oldSubscription: null });
  assert.equal(failing.subscribed.length, 0, "galat ditelan");
});

const navigation = (url = `${ORIGIN}/hub`, method = "GET") => ({ mode: "navigate", method, url });

test("navigasi online: respons jaringan / navigation preload diteruskan apa adanya (tidak pernah disimpan)", async () => {
  const online = new Response("hub");
  assert.equal(await worker({ fetch: async () => online }).fetchEvent(navigation()), online);
  const preloaded = new Response("preload");
  let fetched = 0;
  const sw = worker({ fetch: async () => { fetched += 1; return online; } });
  assert.equal(await sw.fetchEvent(navigation(), Promise.resolve(preloaded)), preloaded);
  assert.equal(fetched, 0, "preload dipakai, tanpa permintaan kedua");
});

test("navigasi offline (jaringan / preload gagal) -> halaman offline bawaan sw.js: HTML, no-store, Coba lagi", async () => {
  const sw = worker({ fetch: async () => { throw new TypeError("Failed to fetch"); } });
  const res = (await sw.fetchEvent(navigation(`${ORIGIN}/hub/my-attendance`))) as Response;
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("content-security-policy"), "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'");
  const html = await res.text();
  assert.match(html, /Kamu sedang offline/);
  assert.match(html, /Coba lagi/);
  const viaPreload = (await sw.fetchEvent(navigation(), Promise.reject(new TypeError("offline")))) as Response;
  assert.match(await viaPreload.text(), /Kamu sedang offline/);
});

test("bukan navigasi GET (API, aset, kiriman formulir) -> tidak disentuh service worker", async () => {
  const sw = worker({ fetch: async () => { throw new Error("tidak boleh dipanggil"); } });
  assert.equal(await sw.fetchEvent({ mode: "cors", method: "GET", url: `${ORIGIN}/api/web/auth/me` }), undefined);
  assert.equal(await sw.fetchEvent({ mode: "no-cors", method: "GET", url: `${ORIGIN}/brand/app-192.png` }), undefined);
  assert.equal(await sw.fetchEvent(navigation(`${ORIGIN}/hub`, "POST")), undefined);
});

test("activate: navigation preload dinyalakan bila ada (Safari lama tanpa preload tetap jalan); tanpa Cache Storage sama sekali", async () => {
  const sw = worker();
  await sw.dispatch("activate", {});
  assert.equal(sw.preloadEnables(), 1);
  await worker({ noPreload: true }).dispatch("activate", {});
  assert.deepEqual([...sw.handlers.keys()].sort(), ["activate", "fetch", "install", "notificationclick", "push", "pushsubscriptionchange"]);
  assert.doesNotMatch(SOURCE, /caches\./, "respons berautentikasi tidak pernah di-cache");
});
