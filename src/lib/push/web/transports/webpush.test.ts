import { test } from "node:test";
import assert from "node:assert/strict";
import type { RequestOptions } from "web-push";
import { generateVapidKeys } from "../vapid-keys";
import type { WebPushSend } from "../types";
import { createWebPushTransport, loadWebPushSender, mapWithLimit, WEB_PUSH_CONCURRENCY, type WebPushSender } from "./webpush";
import { createMemoryWebPushTransport } from "./web-memory";

const KEYS = generateVapidKeys();
const CREDS = { ...KEYS, subject: "mailto:ops@studenthub.id" };
const item = (n: number): WebPushSend => ({
  target: { endpoint: `https://fcm.googleapis.com/fcm/send/rahasia-${n}`, keys: { p256dh: "p", auth: "a" } },
  payload: { notificationId: `n${n}`, title: "t", body: "b", url: "/hub/notifications", tag: `n-n${n}`, badge: 1, icon: "/i", badgeIcon: "/b" },
  ttlSeconds: 600,
});

test("opsi kirim, maks 20 bersamaan, hasil sejajar urutan, 410 = mati, galat tidak pernah dilempar", async () => {
  let inFlight = 0;
  let peak = 0;
  const seen: RequestOptions[] = [];
  const sender: WebPushSender = async (subscription, payload, options) => {
    seen.push(options);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const n = Number(subscription.endpoint.split("-").pop());
    assert.equal(JSON.parse(payload).notificationId, `n${n}`);
    if (n === 3) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    if (n === 4) throw new TypeError("enkripsi gagal");
    if (n === 5) throw Object.assign(new Error("Unavailable"), { statusCode: 503 });
  };
  const transport = createWebPushTransport(CREDS, { loadSender: async () => sender });
  const results = await transport.send(Array.from({ length: 45 }, (_, i) => item(i)));
  assert.equal(results.length, 45);
  assert.ok(peak <= WEB_PUSH_CONCURRENCY && peak > 1, `peak=${peak}`);
  assert.deepEqual(results[0], { kind: "ok" });
  assert.deepEqual(results[3], { kind: "unregistered" });
  assert.deepEqual(results[4], { kind: "fail", error: "WEB_PUSH_REJECTED" });
  assert.deepEqual(results[5], { kind: "retry", error: "HTTP_503" });
  assert.deepEqual([seen[0]?.TTL, seen[0]?.urgency, seen[0]?.contentEncoding, seen[0]?.vapidDetails?.subject], [600, "high", "aes128gcm", "mailto:ops@studenthub.id"]);
});

test("batas waktu keras per kiriman -> coba lagi (galat jaringan)", async () => {
  const transport = createWebPushTransport(CREDS, { loadSender: async () => () => new Promise(() => undefined), timeoutMs: 20 });
  assert.deepEqual(await transport.send([item(1)]), [{ kind: "retry", error: "NETWORK_ERROR" }]);
});

test("pustaka gagal dimuat -> semua coba lagi, tanpa melempar", async () => {
  const transport = createWebPushTransport(CREDS, { loadSender: async () => { throw new Error("modul hilang"); } });
  assert.deepEqual(await transport.send([item(1), item(2)]), [{ kind: "retry", error: "NETWORK_ERROR" }, { kind: "retry", error: "NETWORK_ERROR" }]);
});

test("401/403 dilog hanya host-nya (endpoint = rahasia)", async (t) => {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  t.mock.method(console, "error", capture);
  t.mock.method(console, "log", capture);
  const transport = createWebPushTransport(CREDS, { loadSender: async () => async () => { throw Object.assign(new Error("Forbidden"), { statusCode: 403 }); } });
  assert.deepEqual(await transport.send([item(7)]), [{ kind: "fail", error: "HTTP_403" }]);
  const output = lines.join("\n");
  assert.match(output, /push\.webpush_credentials/);
  assert.match(output, /fcm\.googleapis\.com/);
  assert.equal(output.includes("rahasia-7"), false);
});

test("pemuat bawaan memakai ekspor default web-push (sendNotification bisa dipanggil)", async () => {
  const sender = await loadWebPushSender();
  assert.equal(typeof sender, "function");
  const webpush = (await import("web-push")).default;
  assert.equal(typeof webpush.sendNotification, "function");
  assert.equal(typeof webpush.getVapidHeaders, "function");
  const headers = webpush.getVapidHeaders("https://fcm.googleapis.com", CREDS.subject, KEYS.publicKey, KEYS.privateKey, "aes128gcm");
  assert.match(String(headers.Authorization), /^vapid t=/);
});

test("mapWithLimit menjaga urutan; transport memori mencatat & bisa diskenariokan", async () => {
  assert.deepEqual(await mapWithLimit([3, 1, 2], 2, async (n) => { await new Promise((r) => setTimeout(r, n)); return n * 10; }), [30, 10, 20]);
  const memory = createMemoryWebPushTransport();
  memory.setStatusScript((i) => (i.payload.notificationId === "n2" ? { kind: "unregistered" } : undefined));
  assert.deepEqual(await memory.send([item(1), item(2)]), [{ kind: "ok" }, { kind: "unregistered" }]);
  assert.equal(memory.sent().length, 2);
  memory.reset();
  assert.equal(memory.sent().length, 0);
});
