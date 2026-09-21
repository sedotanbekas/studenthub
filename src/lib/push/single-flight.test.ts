import { test } from "node:test";
import assert from "node:assert/strict";
import { createSingleFlight } from "./single-flight";

interface Gate {
  readonly promise: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("satu putaran sekaligus; panggilan saat berjalan memicu TEPAT satu putaran lagi (ctx terbaru)", async () => {
  const seen: string[] = [];
  const first = gate();
  const flight = createSingleFlight<string, number>(
    async (ctx) => {
      seen.push(ctx);
      if (ctx === "a") await first.promise;
      return 1;
    },
    (x, y) => x + y,
  );
  const a = flight.run(() => "a");
  assert.equal(flight.isRunning(), true);
  const b = flight.run(() => "b");
  const c = flight.run(() => "c");
  assert.equal(a, b, "pemanggil yang bergabung menerima promise yang sama");
  assert.equal(b, c);
  first.open();
  assert.equal(await a, 2, "putaran awal + satu putaran ulang");
  assert.deepEqual(seen, ["a", "c"]);
  assert.equal(flight.isRunning(), false);
});

test("setelah selesai, run berikutnya memulai putaran baru", async () => {
  let passes = 0;
  const flight = createSingleFlight<number, number>(async () => ++passes, (_x, y) => y);
  assert.equal(await flight.run(() => 0), 1);
  assert.equal(await flight.run(() => 0), 2);
});

test("makeContext melempar sinkron: ditolak dan mutex tetap dilepas", async () => {
  const flight = createSingleFlight<number, number>(async (n) => n, (x, y) => x + y);
  await assert.rejects(
    flight.run(() => {
      throw new Error("ctx rusak");
    }),
    /ctx rusak/,
  );
  assert.equal(flight.isRunning(), false);
  assert.equal(await flight.run(() => 3), 3);
});

test("putaran gagal: promise ditolak, mutex dilepas, permintaan tertunda dibuang", async () => {
  const blocker = gate();
  let calls = 0;
  const flight = createSingleFlight<number, number>(
    async () => {
      calls += 1;
      if (calls === 1) {
        await blocker.promise;
        throw new Error("db mati");
      }
      return 7;
    },
    (x, y) => x + y,
  );
  const failing = flight.run(() => 0);
  const joined = flight.run(() => 0);
  blocker.open();
  await assert.rejects(failing, /db mati/);
  await assert.rejects(joined, /db mati/);
  await tick();
  assert.equal(flight.isRunning(), false);
  assert.equal(await flight.run(() => 0), 7);
  assert.equal(calls, 2);
});
