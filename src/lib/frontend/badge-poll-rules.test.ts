import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BADGE_BACKOFF_MAX_MS,
  BADGE_MIN_GAP_MS,
  IDLE_BADGE_STATE,
  affectsUnreadBadge,
  afterRefresh,
  badgeLabel,
  classifyPollFailure,
  decideFetch,
  nextDelayMs,
  parseUnreadTotal,
  retryAfterFromBody,
  type BadgePollState,
} from "./badge-poll-rules";

const T0 = 1_000_000;
const ok = (over: Partial<BadgePollState> = {}): BadgePollState => ({ ...IDLE_BADGE_STATE, lastAttemptAt: T0, lastOk: true, nextDueAt: T0 + 30_000, ...over });

test("decideFetch: start/timer/mutation mengambil; sedang berjalan -> antre (mutasi) / diam; tersembunyi diam kecuali mutasi", () => {
  assert.deepEqual(decideFetch(IDLE_BADGE_STATE, "start", T0, true), { action: "fetch" });
  assert.deepEqual(decideFetch(ok(), "timer", T0 + 30_000, true), { action: "fetch" });
  assert.deepEqual(decideFetch(ok(), "mutation", T0 + 1_000, true), { action: "fetch" });
  assert.deepEqual(decideFetch(ok({ inFlight: true }), "mutation", T0, true), { action: "queue" });
  assert.deepEqual(decideFetch(ok({ inFlight: true }), "focus", T0, true), { action: "idle" });
  assert.deepEqual(decideFetch(ok(), "timer", T0 + 30_000, false), { action: "idle" });
  assert.deepEqual(decideFetch(ok(), "mutation", T0 + 1_000, false), { action: "fetch" });
});

test("decideFetch: kembali terlihat cepat (< 5 dtk) TIDAK mematikan polling — menunggu jadwal berikutnya", () => {
  assert.deepEqual(decideFetch(ok(), "visible", T0 + 3_000, true), { action: "wait", delayMs: 27_000 });
  assert.deepEqual(decideFetch(ok({ nextDueAt: T0 + 2_000 }), "focus", T0 + 3_000, true), { action: "wait", delayMs: BADGE_MIN_GAP_MS - 3_000 }, "jadwal lewat tapi < 5 dtk sejak percobaan");
  assert.deepEqual(decideFetch(ok({ nextDueAt: T0 + 2_000 }), "focus", T0 + BADGE_MIN_GAP_MS, true), { action: "fetch" });
  assert.deepEqual(decideFetch(ok(), "visible", T0 + 600_000, true), { action: "fetch" }, "lama tersembunyi -> langsung");
  assert.deepEqual(decideFetch(IDLE_BADGE_STATE, "visible", T0, true), { action: "fetch" });
});

test("decideFetch: setelah gagal, 'online' langsung mengambil (tanpa jeda 5 dtk), kecuali Retry-After masih berlaku", () => {
  const failed = ok({ lastOk: false, failures: 2, nextDueAt: T0 + 120_000 });
  assert.deepEqual(decideFetch(failed, "online", T0 + 1_000, true), { action: "fetch" });
  assert.deepEqual(decideFetch(failed, "visible", T0 + 1_000, true), { action: "wait", delayMs: 119_000 }, "visible tetap menghormati backoff");
  const limited = ok({ lastOk: false, failures: 1, nextDueAt: T0 + 600_000, notBefore: T0 + 600_000 });
  assert.deepEqual(decideFetch(limited, "online", T0 + 1_000, true), { action: "wait", delayMs: 599_000 });
  assert.deepEqual(decideFetch(limited, "mutation", T0 + 1_000, true), { action: "wait", delayMs: 599_000 }, "mutasi pun menunggu Retry-After");
});

test("nextDelayMs: dasar per peran, jitter ±10% SETELAH batas 5 menit, Retry-After menang", () => {
  assert.equal(nextDelayMs({ role: "SCHOOL_ADMIN", failures: 0, random: 0.5 }), 30_000);
  assert.equal(nextDelayMs({ role: "STUDENT", failures: 0, random: 0.5 }), 60_000);
  assert.equal(nextDelayMs({ role: "SPONSOR", failures: 0, random: 0 }), 27_000);
  assert.equal(nextDelayMs({ role: "SUPER_ADMIN", failures: 0, random: 1 }), 33_000);
  assert.deepEqual([1, 2, 3].map((failures) => nextDelayMs({ role: "SCHOOL_ADMIN", failures, random: 0.5 })), [60_000, 120_000, 240_000]);
  assert.equal(nextDelayMs({ role: "SCHOOL_ADMIN", failures: 4, random: 0.5 }), BADGE_BACKOFF_MAX_MS);
  assert.equal(nextDelayMs({ role: "SCHOOL_ADMIN", failures: 4, random: 0 }), 270_000);
  assert.equal(nextDelayMs({ role: "SCHOOL_ADMIN", failures: 50, random: 1 }), 330_000);
  assert.equal(nextDelayMs({ role: "STUDENT", failures: 0, random: 0.5, retryAfterMs: 600_000 }), 600_000);
});

test("classifyPollFailure: hanya 403 berhenti; 401 (berakhir lewat alur sesi), jaringan, 404, 429, 5xx -> coba lagi", () => {
  assert.equal(classifyPollFailure(403), "stop");
  for (const status of [0, 401, 404, 429, 500, 502, 503]) assert.equal(classifyPollFailure(status), "retry", String(status));
});

test("retryAfterFromBody: dari error.details.retryAfterSeconds (proxy tidak meneruskan header)", () => {
  assert.equal(retryAfterFromBody({ success: false, error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 120 } } }), 120_000);
  for (const body of [null, {}, { error: null }, { error: { details: { retryAfterSeconds: "9" } } }, { error: { details: { retryAfterSeconds: -1 } } }]) {
    assert.equal(retryAfterFromBody(body), undefined, JSON.stringify(body));
  }
});

test("parseUnreadTotal: hanya bilangan bulat >= 0 dari envelope sukses", () => {
  assert.equal(parseUnreadTotal({ success: true, data: { total: 4 } }), 4);
  assert.equal(parseUnreadTotal({ success: true, data: { total: 0 } }), 0);
  for (const body of [{ success: false, data: { total: 3 } }, { success: true }, { success: true, data: { total: "3" } }, { success: true, data: { total: -1 } }, { success: true, data: { total: 2.5 } }, null, "x"]) {
    assert.equal(parseUnreadTotal(body), null, JSON.stringify(body));
  }
});

test("badgeLabel: kosong, angka, 99+", () => {
  assert.deepEqual([0, 1, 99, 100, 12_345].map(badgeLabel), ["", "1", "99", "99+", "99+"]);
});

test("affectsUnreadBadge: hanya tandai dibaca / tandai semua dibaca", () => {
  assert.equal(affectsUnreadBadge("markNotificationRead"), true);
  assert.equal(affectsUnreadBadge("markAllNotificationsRead"), true);
  assert.equal(affectsUnreadBadge("listNotifications"), false);
  assert.equal(affectsUnreadBadge("getNotification"), false);
});

test("afterRefresh: 2xx ulangi; 409 REFRESH_RACE tunggu lalu ulangi; selain itu berakhir", () => {
  assert.equal(afterRefresh(200), "retry");
  assert.equal(afterRefresh(204), "retry");
  assert.equal(afterRefresh(409), "wait-retry");
  for (const status of [400, 401, 403, 500]) assert.equal(afterRefresh(status), "expire", String(status));
});
