import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateOutcome,
  buildPushMessage,
  chunk,
  classifyRequestError,
  classifyTicket,
  isExpired,
  unsentNotificationIds,
  pushLinkOf,
  retryDelayMinutes,
  sanitizeErrorCode,
} from "./rules";

const NOW = new Date("2026-09-21T03:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const withStatus = (statusCode: number | undefined, code?: string) => Object.assign(new Error("gagal"), { statusCode, code });

test("buildPushMessage: format Expo, data deep link, judul <= 100 & isi <= 178 karakter", () => {
  const row = { id: "n1", title: `Judul ${"panjang ".repeat(20)}`, body: `Isi ${"kata ".repeat(60)}`, data: { screen: "invoice", id: "inv1" } };
  const msg = buildPushMessage(row, "ExponentPushToken[abc]");
  assert.equal(msg.to, "ExponentPushToken[abc]");
  assert.deepEqual(msg.data, { notificationId: "n1", screen: "invoice", id: "inv1" });
  assert.equal(msg.sound, "default");
  assert.equal(msg.priority, "high");
  assert.equal(msg.channelId, "default");
  assert.ok(Array.from(msg.title).length <= 100, msg.title);
  assert.ok(Array.from(msg.body).length <= 178, msg.body);
  assert.ok(msg.title.endsWith("…"));
  assert.ok(msg.body.endsWith("…"));
});

test("buildPushMessage: teks pendek apa adanya; emoji tidak terpotong di tengah", () => {
  const msg = buildPushMessage({ id: "n2", title: "Halo", body: "😀".repeat(200), data: null }, "t");
  assert.equal(msg.title, "Halo");
  assert.equal(Array.from(msg.body).length, 178);
  assert.equal(msg.body.includes("�"), false);
  assert.deepEqual(msg.data, { notificationId: "n2", screen: "notification", id: "n2" });
});

test("pushLinkOf: hanya screen/id string yang dipakai", () => {
  assert.deepEqual(pushLinkOf({ screen: "a", id: "b", count: 2 }, "n"), { screen: "a", id: "b" });
  assert.deepEqual(pushLinkOf({ screen: 1, id: "b" }, "n"), { screen: "notification", id: "n" });
  assert.deepEqual(pushLinkOf(["x"], "n"), { screen: "notification", id: "n" });
  assert.deepEqual(pushLinkOf(null, "n"), { screen: "notification", id: "n" });
});

test("classifyTicket: ok / DeviceNotRegistered / MessageRateExceeded / lainnya", () => {
  assert.deepEqual(classifyTicket({ status: "ok", id: "r1" }), { kind: "ok" });
  assert.deepEqual(classifyTicket({ status: "error", message: "\"ExponentPushToken[x]\" bukan penerima", details: { error: "DeviceNotRegistered" } }), { kind: "unregistered" });
  assert.deepEqual(classifyTicket({ status: "error", details: { error: "MessageRateExceeded" } }), { kind: "retry", error: "MessageRateExceeded" });
  assert.deepEqual(classifyTicket({ status: "error", details: { error: "MessageTooBig" } }), { kind: "fail", error: "MessageTooBig" });
  assert.deepEqual(classifyTicket({ status: "error", details: { error: "InvalidCredentials" } }), { kind: "fail", error: "InvalidCredentials" });
  assert.deepEqual(classifyTicket({ status: "error", message: "rahasia ExponentPushToken[x]" }), { kind: "fail", error: "UNKNOWN_ERROR" });
  assert.deepEqual(classifyTicket(undefined), { kind: "retry", error: "MISSING_TICKET" });
});

test("classifyRequestError: 429/5xx/jaringan -> retry; 4xx lain -> fail; tanpa pesan mentah", () => {
  assert.deepEqual(classifyRequestError(withStatus(429)), { kind: "retry", error: "TOO_MANY_REQUESTS" });
  assert.deepEqual(classifyRequestError(withStatus(200, "TOO_MANY_REQUESTS")), { kind: "retry", error: "TOO_MANY_REQUESTS" });
  assert.deepEqual(classifyRequestError(withStatus(503)), { kind: "retry", error: "HTTP_503" });
  assert.deepEqual(classifyRequestError(new TypeError("fetch failed")), { kind: "retry", error: "NETWORK_ERROR" });
  assert.deepEqual(classifyRequestError(withStatus(400, "PUSH_TOO_MANY_EXPERIENCE_IDS")), { kind: "fail", error: "HTTP_400:PUSH_TOO_MANY_EXPERIENCE_IDS" });
  assert.deepEqual(classifyRequestError(withStatus(401, "bukan kode <script>")), { kind: "fail", error: "HTTP_401" });
  assert.deepEqual(classifyRequestError("string aneh"), { kind: "retry", error: "NETWORK_ERROR" });
});

test("retryDelayMinutes: [1, 5, 30] lalu tetap 30", () => {
  assert.deepEqual([0, 1, 2, 3, 9].map(retryDelayMinutes), [1, 5, 30, 30, 30]);
});

test("aggregateOutcome: satu perangkat ok -> SENT", () => {
  assert.deepEqual(aggregateOutcome([{ kind: "fail", error: "X" }, { kind: "ok" }], 0, NOW), { status: "SENT" });
});

test("aggregateOutcome: retry dengan backoff sampai 4 percobaan, lalu FAILED", () => {
  const retry = [{ kind: "retry" as const, error: "HTTP_503" }];
  assert.deepEqual(aggregateOutcome(retry, 0, NOW), { status: "PENDING", nextAttemptAt: minutes(1), error: "HTTP_503" });
  assert.deepEqual(aggregateOutcome(retry, 1, NOW), { status: "PENDING", nextAttemptAt: minutes(5), error: "HTTP_503" });
  assert.deepEqual(aggregateOutcome(retry, 2, NOW), { status: "PENDING", nextAttemptAt: minutes(30), error: "HTTP_503" });
  assert.deepEqual(aggregateOutcome(retry, 3, NOW), { status: "FAILED", error: "HTTP_503" });
});

test("aggregateOutcome: gagal permanen menang atas unregistered; semua unregistered -> FAILED DeviceNotRegistered", () => {
  assert.deepEqual(aggregateOutcome([{ kind: "unregistered" }, { kind: "fail", error: "MessageTooBig" }], 0, NOW), { status: "FAILED", error: "MessageTooBig" });
  assert.deepEqual(aggregateOutcome([{ kind: "unregistered" }], 0, NOW), { status: "FAILED", error: "DeviceNotRegistered" });
  assert.deepEqual(aggregateOutcome([{ kind: "unregistered" }, { kind: "retry", error: "HTTP_502" }], 0, NOW).status, "PENDING");
  assert.deepEqual(aggregateOutcome([], 0, NOW), { status: "SKIPPED", error: "NO_DEVICE" });
});

test("isExpired: lebih tua dari 60 menit", () => {
  assert.equal(isExpired(minutes(-60), NOW), false);
  assert.equal(isExpired(minutes(-61), NOW), true);
  assert.equal(isExpired(minutes(5), NOW), false);
});

test("chunk: potongan <= ukuran, urutan tetap, input tidak dimutasi", () => {
  const items = [1, 2, 3, 4, 5];
  assert.deepEqual(chunk(items, 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 100), []);
  assert.deepEqual(items, [1, 2, 3, 4, 5]);
  assert.throws(() => chunk(items, 0));
});

test("sanitizeErrorCode: hanya [A-Za-z0-9_:.-], maks 255", () => {
  assert.equal(sanitizeErrorCode("HTTP_400:PUSH_X"), "HTTP_400:PUSH_X");
  assert.equal(sanitizeErrorCode("x".repeat(300)).length, 255);
  assert.equal(sanitizeErrorCode("ada spasi"), "UNKNOWN_ERROR");
});

test("unsentNotificationIds: anggaran habis -> notifikasi dengan perangkat yang belum dicoba & tanpa ok dilepas", () => {
  const deliveries = [
    { notificationId: "a" }, { notificationId: "b" }, // chunk terkirim
    { notificationId: "b" }, { notificationId: "c" }, { notificationId: "d" }, { notificationId: "d" }, // belum dicoba
  ];
  const results = [{ kind: "ok" as const }, { kind: "retry" as const, error: "NETWORK_ERROR" }];
  assert.deepEqual([...unsentNotificationIds(deliveries, results)].sort(), ["b", "c", "d"]);
  const partlyOk = [{ kind: "retry" as const, error: "NETWORK_ERROR" }, { kind: "ok" as const }];
  assert.deepEqual([...unsentNotificationIds(deliveries, partlyOk)].sort(), ["c", "d"], "b sudah sampai di satu perangkat -> tetap SENT");
  assert.equal(unsentNotificationIds(deliveries, [...results, ...results, ...results]).size, 0, "semua dicoba -> tidak ada yang dilepas");
});
