import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobContext } from "@/lib/auth/principal";
import { TICK_BUDGET_MS } from "./constants";
import { createTickRunner, type TickDeps } from "./tick-runner";
import { JOB_NAMES, type JobHandler, type JobName, type JobOutcome, type JobResult } from "./types";

type KeyedCall = { job: string; scopeKey: string; runKey: string; ctx: JobContext; result: JobResult };
type QueueCall = { name: string; ctx: JobContext; result: JobResult };

/** Dependensi palsu: mencatat panggilan dan menjalankan fn agar handler ikut teruji. */
function fakeDeps(overrides: Partial<TickDeps> = {}): { deps: TickDeps; keyed: KeyedCall[]; queued: QueueCall[]; ticks: Date[] } {
  const keyed: KeyedCall[] = [];
  const queued: QueueCall[] = [];
  const ticks: Date[] = [];
  const handler = (name: JobName): JobHandler => async (ctx) => ({ handled: name, requestId: ctx.requestId });
  const handlers = Object.fromEntries(JOB_NAMES.map((name) => [name, handler(name)])) as Record<JobName, JobHandler>;
  const deps: TickDeps = {
    handlers,
    runKeyed: async (job, scopeKey, runKey, fn, ctx) => {
      keyed.push({ job, scopeKey, runKey, ctx, result: await fn() });
      return "ran";
    },
    runQueue: async (name, fn, ctx) => {
      queued.push({ name, ctx, result: await fn() });
      return "ran";
    },
    onTick: (at) => ticks.push(at),
    ...overrides,
  };
  return { deps, keyed, queued, ticks };
}

const TICK_AT = new Date("2026-09-21T19:00:00Z");

test("runTick 19:00Z: menjalankan keempat job, keyed lewat runKeyed('global', runKey), queue lewat runQueue", async () => {
  const { deps, keyed, queued } = fakeDeps();
  const result = await createTickRunner(deps).runTick(TICK_AT, "req-tick-1");

  assert.equal(result.tickAt, "2026-09-21T19:00:00.000Z");
  assert.deepEqual(result.results.map((r) => [r.job, r.outcome]), [
    ["push-dispatch", "ran"],
    ["attendance-auto-alpha", "ran"],
    ["files-orphan-cleanup", "ran"],
    ["maintenance-daily", "ran"],
  ]);
  assert.deepEqual(queued.map((c) => c.name), ["push-dispatch", "attendance-auto-alpha"]);
  assert.deepEqual(keyed.map((c) => [c.job, c.scopeKey, c.runKey]), [
    ["files-orphan-cleanup", "global", "2026-09-21T19"],
    ["maintenance-daily", "global", "2026-09-22"],
  ]);
  assert.deepEqual(keyed[0]?.result, { handled: "files-orphan-cleanup", requestId: "req-tick-1" });
});

test("runTick: JobContext berisi now, requestId, dan deadline = now + 50 detik", async () => {
  const { deps, keyed, queued } = fakeDeps();
  await createTickRunner(deps).runTick(TICK_AT, "req-tick-ctx");
  for (const ctx of [...keyed.map((c) => c.ctx), ...queued.map((c) => c.ctx)]) {
    assert.deepEqual(ctx.now, TICK_AT);
    assert.equal(ctx.requestId, "req-tick-ctx");
    assert.equal(ctx.deadline, TICK_AT.getTime() + TICK_BUDGET_MS);
  }
  assert.equal(TICK_BUDGET_MS, 50_000);
});

test("runTick 18:59Z: maintenance-daily tidak dijalankan", async () => {
  const { deps, keyed } = fakeDeps();
  const result = await createTickRunner(deps).runTick(new Date("2026-09-21T18:59:00Z"), "req-tick-2");
  assert.deepEqual(result.results.map((r) => r.job), ["push-dispatch", "attendance-auto-alpha", "files-orphan-cleanup"]);
  assert.deepEqual(keyed.map((c) => c.job), ["files-orphan-cleanup"]);
});

test("runTick: hasil skipped/failed diteruskan; penolakan tak terduga menjadi failed tanpa menggagalkan job lain", async () => {
  const outcomes: Partial<Record<string, JobOutcome>> = { "push-dispatch": "skipped", "attendance-auto-alpha": "failed" };
  const { deps } = fakeDeps({
    runQueue: async (name) => outcomes[name] ?? "ran",
    runKeyed: async (job) => {
      if (job === "files-orphan-cleanup") throw new Error("DB mati");
      return "ran";
    },
  });
  const result = await createTickRunner(deps).runTick(TICK_AT, "req-tick-3");
  assert.deepEqual(result.results.map((r) => [r.job, r.outcome]), [
    ["push-dispatch", "skipped"],
    ["attendance-auto-alpha", "failed"],
    ["files-orphan-cleanup", "failed"],
    ["maintenance-daily", "ran"],
  ]);
});

test("runTick: ms berupa bilangan bulat non-negatif dan onTick mencatat waktu tick", async () => {
  const { deps, ticks } = fakeDeps();
  const result = await createTickRunner(deps).runTick(TICK_AT, "req-tick-4");
  for (const r of result.results) assert.ok(Number.isInteger(r.ms) && r.ms >= 0, `${r.job}: ${r.ms}`);
  assert.deepEqual(ticks, [TICK_AT]);
});

test("runSingleJob: job keyed memakai runKey penjadwal, tidak mencatat tick, ms dari jam yang disuntik", async () => {
  const readings = [100, 142.6];
  const { deps, keyed, ticks } = fakeDeps({ elapsed: () => readings.shift() ?? 0 });
  const now = new Date("2026-09-21T10:00:00Z");
  const result = await createTickRunner(deps).runSingleJob("maintenance-daily", now, "req-single-1");
  assert.deepEqual(result, { tickAt: "2026-09-21T10:00:00.000Z", results: [{ job: "maintenance-daily", outcome: "ran", ms: 43 }] });
  assert.deepEqual(keyed.map((c) => [c.job, c.scopeKey, c.runKey]), [["maintenance-daily", "global", "2026-09-21"]]);
  assert.deepEqual(ticks, []);
});

test("runSingleJob: job queue lewat runQueue", async () => {
  const { deps, queued, keyed } = fakeDeps();
  const result = await createTickRunner(deps).runSingleJob("push-dispatch", TICK_AT, "req-single-2");
  assert.deepEqual(result.results.map((r) => [r.job, r.outcome]), [["push-dispatch", "ran"]]);
  assert.deepEqual(queued.map((c) => c.name), ["push-dispatch"]);
  assert.equal(keyed.length, 0);
});

test("runSingleJob: penolakan tak terduga menjadi failed", async () => {
  const { deps } = fakeDeps({ runQueue: async () => { throw new Error("tak terduga"); } });
  const result = await createTickRunner(deps).runSingleJob("attendance-auto-alpha", TICK_AT, "req-single-3");
  assert.deepEqual(result.results.map((r) => r.outcome), ["failed"]);
});

test("scope (test integrasi) diteruskan ke JobContext semua job; tanpa scope -> ctx tanpa scope", async () => {
  const scoped = fakeDeps({ scope: () => ({ schoolIds: [], userIds: [] }) });
  await createTickRunner(scoped.deps).runTick(TICK_AT, "req-scope");
  for (const call of [...scoped.keyed, ...scoped.queued]) assert.deepEqual(call.ctx.scope, { schoolIds: [], userIds: [] });
  const plain = fakeDeps();
  await createTickRunner(plain.deps).runTick(TICK_AT, "req-plain");
  for (const call of [...plain.keyed, ...plain.queued]) assert.equal("scope" in call.ctx, false);
});
