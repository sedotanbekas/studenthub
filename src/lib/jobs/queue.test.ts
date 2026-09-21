import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@/lib/auth/principal";
import { runQueueJob } from "./queue";
import type { JobResult } from "./types";

const NOW = new Date("2026-09-21T03:00:00Z");
const CTX: JobContext = { now: NOW, requestId: "req-test-queue", deadline: NOW.getTime() + 50_000 };

/** Job yang baru selesai ketika `release()` dipanggil. */
function gated(): { fn: () => Promise<JobResult>; release: () => void; calls: () => number } {
  let calls = 0;
  let release: () => void = () => undefined;
  const fn = (): Promise<JobResult> => {
    calls += 1;
    return new Promise((resolve) => {
      release = () => resolve({ processed: 1 });
    });
  };
  return { fn, release: () => release(), calls: () => calls };
}

test("runQueueJob: sukses → ran", async () => {
  assert.equal(await runQueueJob("q-sukses", async () => ({ sent: 3 }), CTX), "ran");
});

test("runQueueJob: fn melempar → failed tanpa melempar ke pemanggil", async () => {
  assert.equal(await runQueueJob("q-gagal", async () => { throw new Error("gagal"); }, CTX), "failed");
});

test("runQueueJob: job bernama sama yang masih berjalan dilewati (mutex per nama)", async () => {
  const job = gated();
  const first = runQueueJob("q-mutex", job.fn, CTX);
  assert.equal(await runQueueJob("q-mutex", job.fn, CTX), "skipped");
  job.release();
  assert.equal(await first, "ran");
  assert.equal(job.calls(), 1);
});

test("runQueueJob: mutex dilepas setelah selesai maupun gagal", async () => {
  assert.equal(await runQueueJob("q-lepas", async () => { throw new Error("gagal"); }, CTX), "failed");
  assert.equal(await runQueueJob("q-lepas", async () => ({}), CTX), "ran");
  assert.equal(await runQueueJob("q-lepas", async () => ({}), CTX), "ran");
});

test("runQueueJob: nama berbeda berjalan bersamaan", async () => {
  const a = gated();
  const b = gated();
  const runs = [runQueueJob("q-a", a.fn, CTX), runQueueJob("q-b", b.fn, CTX)];
  a.release();
  b.release();
  assert.deepEqual(await Promise.all(runs), ["ran", "ran"]);
});
