import { test } from "node:test";
import assert from "node:assert/strict";
import { handleJobRequest, type JobEndpointDeps } from "./endpoint";
import type { TickResult } from "./tick-runner";
import type { JobName } from "./types";

const SECRET = "rahasia-job-0123456789abcdef0123456789";
const NOW = new Date("2026-09-21T19:00:00Z");
const TICK_RESULT: TickResult = { tickAt: NOW.toISOString(), results: [{ job: "push-dispatch", outcome: "ran", ms: 3 }] };

type Calls = { secretReads: number; ticks: Array<[Date, string]>; singles: Array<[JobName, Date, string]> };

function deps(overrides: Partial<JobEndpointDeps> = {}): { deps: JobEndpointDeps; calls: Calls } {
  const calls: Calls = { secretReads: 0, ticks: [], singles: [] };
  const base: JobEndpointDeps = {
    jobSecret: () => {
      calls.secretReads += 1;
      return SECRET;
    },
    runTick: async (now, requestId) => {
      calls.ticks.push([now, requestId]);
      return TICK_RESULT;
    },
    runSingleJob: async (name, now, requestId) => {
      calls.singles.push([name, now, requestId]);
      return { tickAt: now.toISOString(), results: [{ job: name, outcome: "skipped", ms: 1 }] };
    },
    now: () => NOW,
    newRequestId: () => "req-endpoint-1",
  };
  return { deps: { ...base, ...overrides }, calls };
}

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1:3020/api/internal/jobs/tick", { method: "POST", headers });
}

async function assertNotFound(res: Response): Promise<void> {
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = (await res.json()) as { success: boolean; error: { code: string; message: string } };
  assert.equal(body.success, false);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.error.message, "Tidak ditemukan.");
}

test("X-Real-IP ada (lewat nginx) → 404 walau secret benar, tanpa membaca secret atau menjalankan job", async () => {
  const { deps: d, calls } = deps();
  const res = await handleJobRequest(request({ "x-job-secret": SECRET, "x-real-ip": "203.0.113.9" }), "tick", d);
  await assertNotFound(res);
  assert.equal(calls.secretReads, 0);
  assert.equal(calls.ticks.length, 0);
});

test("tanpa X-Job-Secret → 404", async () => {
  const { deps: d, calls } = deps();
  await assertNotFound(await handleJobRequest(request(), "tick", d));
  assert.equal(calls.ticks.length, 0);
});

test("X-Job-Secret salah → 404", async () => {
  const { deps: d, calls } = deps();
  await assertNotFound(await handleJobRequest(request({ "x-job-secret": "salah" }), "tick", d));
  assert.equal(calls.ticks.length, 0);
});

test("secret benar + job tidak dikenal → 404 tanpa menjalankan apa pun", async () => {
  const { deps: d, calls } = deps();
  await assertNotFound(await handleJobRequest(request({ "x-job-secret": SECRET }), "hapus-semua", d));
  assert.equal(calls.ticks.length + calls.singles.length, 0);
});

test("secret benar + 'tick' → 200 envelope ok berisi hasil tick, no-store, X-Request-Id", async () => {
  const { deps: d, calls } = deps();
  const res = await handleJobRequest(request({ "x-job-secret": SECRET }), "tick", d);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-request-id"), "req-endpoint-1");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(await res.json(), { success: true, data: TICK_RESULT, error: null, meta: null });
  assert.deepEqual(calls.ticks, [[NOW, "req-endpoint-1"]]);
});

test("secret benar + nama job → runSingleJob untuk job itu saja", async () => {
  const { deps: d, calls } = deps();
  const res = await handleJobRequest(request({ "x-job-secret": SECRET }), "maintenance-daily", d);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { data: TickResult };
  assert.deepEqual(body.data.results, [{ job: "maintenance-daily", outcome: "skipped", ms: 1 }]);
  assert.deepEqual(calls.singles, [["maintenance-daily", NOW, "req-endpoint-1"]]);
  assert.equal(calls.ticks.length, 0);
});

test("error tak terduga saat tick → 500 INTERNAL_ERROR hanya dengan requestId (tanpa stack/pesan asli)", async () => {
  const { deps: d } = deps({ runTick: async () => { throw new Error("rahasia SQL: SELECT * FROM User"); } });
  const res = await handleJobRequest(request({ "x-job-secret": SECRET }), "tick", d);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const text = await res.text();
  assert.equal(text.includes("SELECT"), false);
  const body = JSON.parse(text) as { error: { code: string; requestId: string } };
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.requestId, "req-endpoint-1");
});

test("tanpa now/newRequestId: memakai jam sistem dan UUID acak", async () => {
  const { deps: d, calls } = deps({ now: undefined, newRequestId: undefined });
  const res = await handleJobRequest(request({ "x-job-secret": SECRET }), "tick", d);
  assert.equal(res.status, 200);
  const [now, requestId] = calls.ticks[0] ?? [];
  assert.ok(now instanceof Date && Math.abs(now.getTime() - Date.now()) < 60_000);
  assert.match(requestId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(res.headers.get("x-request-id"), requestId);
});
