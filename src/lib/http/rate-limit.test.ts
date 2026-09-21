import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter, FAIL_CLOSED_RETRY_AFTER_SECONDS } from "./rate-limit";

const MIN = 60_000;

function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let current = start;
  return { now: () => current, advance: (ms: number) => { current += ms; } };
}

test("mengizinkan sampai batas lalu mengunci saat hitungan mencapai limit", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 3, windowMs: 10 * MIN, lockMs: 15 * MIN }, clock.now);
  for (let i = 0; i < 2; i += 1) {
    assert.deepEqual(rl.check("k"), { ok: true });
    rl.hit("k");
  }
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 15 * 60 });
});

test("kunci berakhir setelah lockMs dan hitungan dimulai dari awal", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 10 * MIN, lockMs: 15 * MIN }, clock.now);
  rl.hit("k");
  rl.hit("k");
  clock.advance(15 * MIN - 1);
  assert.equal(rl.check("k").ok, false);
  clock.advance(1);
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: true });
});

test("tanpa lockMs, key terblokir sampai sisa jendela habis", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60_000 }, clock.now);
  rl.hit("k");
  clock.advance(20_000);
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 40 });
  clock.advance(40_000);
  assert.deepEqual(rl.check("k"), { ok: true });
});

test("jendela tetap: hitungan direset setelah jendela berakhir", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 3, windowMs: 60_000 }, clock.now);
  rl.hit("k");
  rl.hit("k");
  clock.advance(60_000);
  rl.hit("k");
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.equal(rl.check("k").ok, false);
});

test("retryAfterSeconds dibulatkan ke atas", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, lockMs: 10_000 }, clock.now);
  rl.hit("k");
  clock.advance(8_500);
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 2 });
  clock.advance(1_499);
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 1 });
});

test("hit saat terkunci tidak memperpanjang kunci", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, lockMs: 30_000 }, clock.now);
  rl.hit("k");
  clock.advance(10_000);
  rl.hit("k");
  rl.recordFailure("k");
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 20 });
});

test("kunci kedaluwarsa di dalam jendela aktif: satu percobaan lalu terkunci lagi", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60 * MIN, lockMs: MIN }, clock.now);
  rl.hit("k");
  rl.hit("k");
  clock.advance(MIN);
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 60 });
});

test("key saling independen", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000 }, clock.now);
  rl.hit("a");
  assert.equal(rl.check("a").ok, false);
  assert.deepEqual(rl.check("b"), { ok: true });
});

test("recordFailure identik dengan hit", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60_000, lockMs: 60_000 }, clock.now);
  rl.recordFailure("k");
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.recordFailure("k");
  assert.equal(rl.check("k").ok, false);
});

test("reset menghapus key (termasuk kunci aktif)", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, lockMs: 60_000 }, clock.now);
  rl.hit("k");
  assert.equal(rl.size(), 1);
  rl.reset("k");
  assert.equal(rl.size(), 0);
  assert.deepEqual(rl.check("k"), { ok: true });
});

test("check tidak membuat entri baru", () => {
  const rl = createRateLimiter({ limit: 5, windowMs: 60_000 }, fakeClock().now);
  rl.check("x");
  rl.check("y");
  assert.equal(rl.size(), 0);
});

test("clear mengosongkan semua key", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000 }, fakeClock().now);
  rl.hit("a");
  rl.hit("b");
  rl.clear();
  assert.equal(rl.size(), 0);
  assert.deepEqual(rl.check("a"), { ok: true });
});

test("clock default memakai Date.now", () => {
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
  rl.hit("k");
  const res = rl.check("k");
  assert.equal(res.ok, false);
  assert.ok(!res.ok && res.retryAfterSeconds >= 59 && res.retryAfterSeconds <= 60);
});

test("sweep membuang entri kedaluwarsa saat kapasitas penuh", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 5, windowMs: 60_000, maxKeys: 3 }, clock.now);
  rl.hit("a");
  rl.hit("b");
  rl.hit("c");
  clock.advance(60_000);
  rl.hit("d");
  assert.equal(rl.size(), 1);
  assert.deepEqual(rl.check("e"), { ok: true });
});

test("sweep TIDAK PERNAH membuang key yang sedang terkunci", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60_000, lockMs: 10 * MIN, maxKeys: 3 }, clock.now);
  rl.hit("locked");
  rl.hit("locked");
  rl.hit("b");
  rl.hit("c");
  clock.advance(60_000);
  for (const key of ["n1", "n2", "n3", "n4"]) rl.hit(key);
  assert.equal(rl.size(), 3);
  assert.equal(rl.check("locked").ok, false);
  assert.deepEqual(rl.check("n1"), { ok: true });
  assert.equal(rl.check("n3").ok, false);
});

test("penuh setelah sweep: check key BARU gagal-tertutup, key lama tetap normal", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 60_000, lockMs: 10 * MIN, maxKeys: 2 }, clock.now);
  rl.hit("a");
  rl.hit("b");
  rl.hit("new");
  assert.equal(rl.size(), 2);
  assert.deepEqual(rl.check("new"), { ok: false, retryAfterSeconds: FAIL_CLOSED_RETRY_AFTER_SECONDS });
  assert.equal(FAIL_CLOSED_RETRY_AFTER_SECONDS, 60);
  assert.equal(rl.check("a").ok, false);
  rl.reset("a");
  assert.deepEqual(rl.check("new"), { ok: true });
});

test("penuh oleh key belum terkunci namun jendelanya aktif: tetap gagal-tertutup", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 10, windowMs: 60_000, maxKeys: 2 }, clock.now);
  rl.hit("a");
  rl.hit("b");
  assert.equal(rl.check("c").ok, false);
  assert.deepEqual(rl.check("a"), { ok: true });
  rl.hit("a");
  clock.advance(60_000);
  assert.deepEqual(rl.check("c"), { ok: true });
  rl.hit("c");
  assert.equal(rl.size(), 1);
});

test("banjir key unik tidak pernah melampaui maxKeys", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 1, windowMs: 1_000, lockMs: 5_000, maxKeys: 50 }, clock.now);
  for (let i = 0; i < 1_000; i += 1) {
    rl.hit(`k${i}`);
    clock.advance(7);
    assert.ok(rl.size() <= 50);
  }
});

test("konfigurasi tidak valid ditolak saat pembuatan", () => {
  assert.throws(() => createRateLimiter({ limit: 0, windowMs: 1_000 }));
  assert.throws(() => createRateLimiter({ limit: 1.5, windowMs: 1_000 }));
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 0 }));
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 1_000, lockMs: -1 }));
  assert.throws(() => createRateLimiter({ limit: 1, windowMs: 1_000, maxKeys: 0 }));
});

test("release mengurangi hitungan jendela aktif satu per satu", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 3, windowMs: 10 * MIN, lockMs: 15 * MIN }, clock.now);
  rl.hit("k");
  rl.hit("k");
  rl.release("k");
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 15 * 60 });
});

test("release sampai nol menghapus entri; key tak dikenal = no-op (tidak negatif)", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60_000 }, clock.now);
  rl.release("tidak-ada");
  assert.equal(rl.size(), 0);
  rl.hit("k");
  rl.release("k");
  assert.equal(rl.size(), 0);
  rl.release("k");
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.equal(rl.check("k").ok, false);
});

test("release tidak membuka atau memperpendek kunci aktif", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60 * MIN, lockMs: MIN }, clock.now);
  rl.hit("k");
  rl.hit("k");
  clock.advance(10_000);
  rl.release("k");
  rl.release("k");
  rl.release("k");
  assert.equal(rl.size(), 1);
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 50 });
  clock.advance(50_000);
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: true });
});

test("release pada entri kedaluwarsa = no-op; hit berikutnya membuka jendela baru", () => {
  const clock = fakeClock();
  const rl = createRateLimiter({ limit: 2, windowMs: 60_000 }, clock.now);
  rl.hit("k");
  clock.advance(60_000);
  rl.release("k");
  assert.equal(rl.size(), 1);
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: true });
  rl.hit("k");
  assert.deepEqual(rl.check("k"), { ok: false, retryAfterSeconds: 60 });
});
