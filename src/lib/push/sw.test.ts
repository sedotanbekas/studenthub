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

function worker(options: { clients?: FakeClient[]; fetch?: (url: string, init?: { method?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }> } = {}) {
  const handlers = new Map<string, Handler>();
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const badges: Array<number | "clear"> = [];
  const opened: string[] = [];
  const subscribed: unknown[] = [];
  const windows = options.clients ?? [];
  const self = {
    location: { origin: ORIGIN },
    navigator: { async setAppBadge(n: number) { badges.push(n); }, async clearAppBadge() { badges.push("clear"); } },
    registration: {
      async showNotification(title: string, opts: Record<string, unknown>) { shown.push({ title, options: opts }); },
      pushManager: { async subscribe(opts: unknown) { subscribed.push(opts); return { toJSON: () => ({ endpoint: "https://fcm.googleapis.com/fcm/send/baru", keys: { p256dh: "p", auth: "a" } }) }; } },
    },
    clients: { async matchAll() { return windows; }, async openWindow(url: string) { opened.push(url); }, async claim() {} },
    skipWaiting() {},
    addEventListener(type: string, handler: Handler) { handlers.set(type, handler); },
  };
  const context = createContext({ self, URL, atob, Uint8Array, Promise, JSON, String, fetch: options.fetch ?? (async () => ({ ok: false, status: 500, json: async () => null })) });
  runInContext(SOURCE, context);
  async function dispatch(type: string, extra: Record<string, unknown>) {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)?.({ ...extra, waitUntil: (p: Promise<unknown>) => pending.push(p) });
    await Promise.all(pending);
  }
  return { dispatch, shown, badges, opened, subscribed, handlers };
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

test("tanpa handler fetch (respons berautentikasi tidak pernah di-cache)", () => {
  const sw = worker();
  assert.equal(sw.handlers.has("fetch"), false);
  assert.deepEqual([...sw.handlers.keys()].sort(), ["activate", "install", "notificationclick", "push", "pushsubscriptionchange"]);
});
