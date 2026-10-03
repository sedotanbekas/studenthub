import { test } from "node:test";
import assert from "node:assert/strict";
import { UnreadBadgePoller, type BadgeDeps, type BadgeSignal, type FetchResult } from "./unread-badge";

/** Dependensi palsu: jam manual, antrean timer, fetch yang dijawab test, sinyal halaman manual. */
function harness(options: { visible?: boolean } = {}) {
  let now = 0;
  let visible = options.visible ?? true;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const calls: Array<{ signal: AbortSignal; resolve: (r: FetchResult) => void; reject: (e: unknown) => void }> = [];
  let emit: ((s: BadgeSignal) => void) | null = null;
  const deps: BadgeDeps = {
    fetchUnread: (signal) => new Promise<FetchResult>((resolve, reject) => calls.push({ signal, resolve, reject })),
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: (id) => { timers.delete(id as number); },
    now: () => now,
    random: () => 0.5,
    isVisible: () => visible,
    listen: (on) => { emit = on; return () => { emit = null; }; },
  };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return {
    poller: new UnreadBadgePoller(deps),
    calls,
    timers,
    get listening() { return emit !== null; },
    async advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        timers.delete(due[0]);
        due[1].fn();
        await flush();
      }
      now = end;
    },
    async signal(s: BadgeSignal) { if (s === "hidden") visible = false; if (s === "visible") visible = true; emit?.(s); await flush(); },
    async reply(total: number, index = calls.length - 1) { calls[index]!.resolve({ status: 200, body: { success: true, data: { total } } }); await flush(); },
    async fail(status: number, body: unknown = null, index = calls.length - 1) { calls[index]!.resolve({ status, body }); await flush(); },
    nextTimerIn: () => Math.min(...[...timers.values()].map((t) => t.at)) - now,
  };
}

const ADMIN = { userId: "u1", role: "SCHOOL_ADMIN" } as const;

test("start: satu fetch; sukses mengisi angka & memberi tahu sekali; timer berikutnya 30 dtk", async () => {
  const h = harness();
  let notified = 0;
  h.poller.subscribe(() => notified++);
  h.poller.start(ADMIN);
  assert.equal(h.calls.length, 1);
  await h.reply(4);
  assert.deepEqual([h.poller.getSnapshot(), notified, h.nextTimerIn()], [4, 1, 30_000]);
  await h.advance(30_000);
  assert.equal(h.calls.length, 2);
  await h.reply(4);
  assert.equal(notified, 1, "angka sama tidak memberi tahu ulang");
});

test("tersembunyi menjeda; terlihat lagi setelah lama -> langsung; focus 1 dtk kemudian tidak menggandakan", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.reply(1);
  await h.signal("hidden");
  assert.equal(h.timers.size, 0);
  await h.advance(600_000);
  assert.equal(h.calls.length, 1);
  await h.signal("visible");
  assert.equal(h.calls.length, 2);
  await h.reply(2);
  await h.advance(1_000);
  await h.signal("focus");
  assert.equal(h.calls.length, 2);
  assert.equal(h.nextTimerIn(), 29_000);
});

test("sembunyi-tampil cepat (< 5 dtk) TIDAK mematikan polling: tepat satu fetch saat jadwal 30 dtk", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.reply(1);
  await h.advance(1_000);
  await h.signal("hidden");
  await h.advance(2_000);
  await h.signal("visible");
  assert.equal(h.calls.length, 1, "tidak langsung");
  await h.advance(27_000);
  assert.equal(h.calls.length, 2, "jadwal 30 dtk tetap berjalan");
});

test("hasil tiba saat tersembunyi, lalu terlihat < 5 dtk: polling tetap berlanjut", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.signal("hidden");
  await h.reply(3);
  assert.equal(h.timers.size, 0);
  await h.advance(2_000);
  await h.signal("visible");
  assert.equal(h.calls.length, 1);
  await h.advance(30_000);
  assert.equal(h.calls.length, 2);
});

test("galat 503 berulang -> 60/120/240/300/300 dtk; sukses -> kembali 30 dtk; angka lama tetap", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.reply(7);
  const delays: number[] = [];
  for (let i = 0; i < 5; i++) {
    await h.advance(h.nextTimerIn());
    await h.fail(503);
    delays.push(h.nextTimerIn());
  }
  assert.deepEqual(delays, [60_000, 120_000, 240_000, 300_000, 300_000]);
  assert.equal(h.poller.getSnapshot(), 7);
  await h.advance(h.nextTimerIn());
  await h.reply(8);
  assert.deepEqual([h.poller.getSnapshot(), h.nextTimerIn()], [8, 30_000]);
});

test("429 dengan retryAfterSeconds di body -> menunggu 600 dtk; focus/refresh di tengah tidak menembus", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.fail(429, { success: false, error: { code: "RATE_LIMITED", details: { retryAfterSeconds: 600 } } });
  assert.equal(h.nextTimerIn(), 600_000);
  await h.advance(10_000);
  await h.signal("focus");
  h.poller.refresh();
  assert.equal(h.calls.length, 1);
  await h.advance(590_000);
  assert.equal(h.calls.length, 2);
});

test("401 -> coba lagi (sesi yang benar-benar berakhir ditangani alur sesi); 403 -> berhenti total", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.reply(5);
  await h.advance(30_000);
  await h.fail(401);
  assert.deepEqual([h.poller.getSnapshot(), h.nextTimerIn()], [5, 60_000]);
  await h.advance(60_000);
  await h.fail(403);
  assert.deepEqual([h.poller.getSnapshot(), h.timers.size, h.listening], [0, 0, false]);
});

test("refresh() saat sedang mengambil -> tepat satu fetch tambahan setelah yang pertama selesai", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  h.poller.refresh();
  h.poller.refresh();
  assert.equal(h.calls.length, 1);
  await h.reply(3);
  assert.equal(h.calls.length, 2);
  await h.reply(0);
  assert.equal(h.poller.getSnapshot(), 0);
});

test("stop() saat mengambil: sinyal dibatalkan, jawaban terlambat diabaikan, angka 0; refresh() sesudah stop tidak mengambil", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  h.poller.stop();
  assert.equal(h.calls[0]?.signal.aborted, true);
  await h.reply(9, 0);
  assert.equal(h.poller.getSnapshot(), 0);
  h.poller.refresh();
  assert.deepEqual([h.calls.length, h.timers.size, h.listening], [1, 0, false]);
});

test("ganti akun: angka langsung 0, hasil akun lama diabaikan, backoff tidak terbawa", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  await h.reply(4);
  await h.advance(30_000);
  await h.fail(503);
  h.poller.start({ userId: "u2", role: "STUDENT" });
  assert.equal(h.poller.getSnapshot(), 0);
  assert.equal(h.calls.length, 3, "akun baru langsung mengambil");
  await h.reply(2);
  assert.deepEqual([h.poller.getSnapshot(), h.nextTimerIn()], [2, 60_000], "siswa 60 dtk, kegagalan akun lama tidak terbawa");

  const g = harness();
  g.poller.start(ADMIN);
  g.poller.stop();
  g.poller.start({ userId: "u3", role: "SPONSOR" });
  assert.equal(g.calls.length, 2, "start setelah stop di tengah permintaan langsung mengambil");
  await g.reply(6, 0);
  assert.equal(g.poller.getSnapshot(), 0, "jawaban permintaan yang dibatalkan diabaikan");
  await g.reply(1, 1);
  assert.equal(g.poller.getSnapshot(), 1);
});

test("start sesi yang sama dua kali -> satu fetch; 200 cacat -> backoff tanpa mengubah angka", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  h.poller.start(ADMIN);
  assert.equal(h.calls.length, 1);
  await h.reply(2);
  await h.advance(30_000);
  await h.fail(200, { success: true, data: { total: "x" } });
  assert.deepEqual([h.poller.getSnapshot(), h.nextTimerIn()], [2, 60_000]);
});

test("galat jaringan lalu 'online' -> langsung mengambil", async () => {
  const h = harness();
  h.poller.start(ADMIN);
  h.calls[0]!.reject(new TypeError("Failed to fetch"));
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.nextTimerIn(), 60_000);
  await h.advance(2_000);
  await h.signal("online");
  assert.equal(h.calls.length, 2);
});
