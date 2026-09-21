import { test } from "node:test";
import assert from "node:assert/strict";
import { createSemaphore } from "./semaphore";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

test("createSemaphore: tidak pernah melebihi batas konkurensi dan urutan FIFO", async () => {
  const sem = createSemaphore(2);
  const gates = Array.from({ length: 5 }, () => deferred());
  const started: number[] = [];
  let running = 0;
  let peak = 0;
  const tasks = gates.map((gate, i) =>
    sem.run(async () => {
      started.push(i);
      running += 1;
      peak = Math.max(peak, running);
      await gate.promise;
      running -= 1;
      return i;
    }),
  );
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, [0, 1]);
  assert.equal(sem.pending, 3);
  for (const gate of gates) gate.resolve();
  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.deepEqual(started, [0, 1, 2, 3, 4]);
  assert.equal(sem.active, 0);
  assert.equal(sem.pending, 0);
});

test("createSemaphore: slot dilepas walau tugas gagal", async () => {
  const sem = createSemaphore(1);
  await assert.rejects(sem.run(async () => {
    throw new Error("gagal");
  }), /gagal/);
  assert.equal(await sem.run(async () => "lanjut"), "lanjut");
  assert.equal(sem.active, 0);
});

test("createSemaphore: batas tidak valid ditolak", () => {
  assert.throws(() => createSemaphore(0), RangeError);
  assert.throws(() => createSemaphore(1.5), RangeError);
});
