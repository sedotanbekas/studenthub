import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { isAppError } from "./errors";
import { assertRateLimit, getLimiter, RATE_LIMITS, resetAllLimiters, type RateLimitName } from "./rate-limits";

const MIN = 60_000;

beforeEach(() => {
  resetAllLimiters();
});

test("konfigurasi bernama sesuai rencana", () => {
  const expected: Record<RateLimitName, { limit: number; windowMs: number; lockMs?: number }> = {
    LOGIN_PAIR: { limit: 8, windowMs: 10 * MIN, lockMs: 15 * MIN },
    LOGIN_IDENTIFIER: { limit: 10, windowMs: 15 * MIN, lockMs: 15 * MIN },
    LOGIN_IP: { limit: 200, windowMs: 10 * MIN, lockMs: 15 * MIN },
    REFRESH_IP: { limit: 600, windowMs: MIN },
    CHANGE_PASSWORD: { limit: 5, windowMs: 15 * MIN, lockMs: 15 * MIN },
    ADMIN_RESET: { limit: 30, windowMs: 60 * MIN },
    TOTP_VERIFY: { limit: 5, windowMs: 15 * MIN, lockMs: 15 * MIN },
    CHECK_IN: { limit: 10, windowMs: 10 * MIN },
    UPLOAD: { limit: 30, windowMs: 10 * MIN },
    IMPORT: { limit: 10, windowMs: 60 * MIN },
    AD_CLICK: { limit: 10, windowMs: MIN },
    AD_IMPRESSION: { limit: 30, windowMs: MIN },
  };
  assert.deepEqual(RATE_LIMITS, expected);
});

test("getLimiter mengembalikan singleton per nama", () => {
  assert.equal(getLimiter("LOGIN_PAIR"), getLimiter("LOGIN_PAIR"));
  assert.notEqual(getLimiter("LOGIN_PAIR"), getLimiter("LOGIN_IP"));
});

test("singleton disimpan di globalThis (bertahan saat hot-reload modul)", () => {
  const limiter = getLimiter("UPLOAD");
  const registry = (globalThis as Record<string, unknown>)["__studenthubRateLimiters"];
  assert.ok(registry instanceof Map);
  assert.equal(registry.get("UPLOAD"), limiter);
});

test("CHECK_IN memblokir percobaan ke-11 dalam 10 menit", () => {
  const limiter = getLimiter("CHECK_IN");
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(limiter.check("checkin:u1"), { ok: true });
    limiter.hit("checkin:u1");
  }
  assert.equal(limiter.check("checkin:u1").ok, false);
});

test("resetAllLimiters mengosongkan state, termasuk referensi yang disimpan pemanggil", () => {
  const limiter = getLimiter("AD_CLICK");
  for (let i = 0; i < 10; i += 1) limiter.hit("click:u1");
  assert.equal(limiter.check("click:u1").ok, false);
  resetAllLimiters();
  assert.deepEqual(limiter.check("click:u1"), { ok: true });
  assert.deepEqual(getLimiter("AD_CLICK").check("click:u1"), { ok: true });
});

test("assertRateLimit melempar 429 RATE_LIMITED dengan Retry-After saat terblokir", () => {
  const limiter = getLimiter("CHANGE_PASSWORD");
  for (let i = 0; i < 5; i += 1) limiter.recordFailure("chpw:u1");
  assert.doesNotThrow(() => assertRateLimit("CHANGE_PASSWORD", "chpw:u2"));
  try {
    assertRateLimit("CHANGE_PASSWORD", "chpw:u1");
    assert.fail("seharusnya melempar");
  } catch (error) {
    assert.ok(isAppError(error));
    assert.equal(error.status, 429);
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.headers?.["Retry-After"], String(15 * 60));
    assert.deepEqual(error.details, { retryAfterSeconds: 15 * 60 });
  }
});
