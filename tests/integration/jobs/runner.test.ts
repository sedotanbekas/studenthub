import { after, test } from "node:test";
import assert from "node:assert/strict";
import { POST } from "@/app/api/internal/jobs/[job]/route";
import { resetEnvCache } from "@/lib/env";
import { runKeyedJob, runQueueJob } from "@/lib/jobs/runner";
import { getLastTickAt, runSingleJob, setTickScopeForTests } from "@/lib/jobs/tick";
import { disconnect, prisma, uniq } from "../helpers/db";
import { callRoute } from "../helpers/request";

after(disconnect);
const ctx = (now = new Date()) => ({ now, requestId: uniq("req"), deadline: now.getTime() + 50_000 });

test("runKeyedJob: sekali jalan per kunci, lalu dilewati", async () => {
  const job = `uji-${uniq()}`;
  let calls = 0;
  const fn = async () => ({ calls: ++calls });
  assert.equal(await runKeyedJob(job, "global", "k1", fn, ctx()), "ran");
  assert.equal(await runKeyedJob(job, "global", "k1", fn, ctx()), "skipped");
  const row = await prisma.jobRun.findFirstOrThrow({ where: { job } });
  assert.equal(row.status, "SUCCEEDED");
  assert.deepEqual(row.result, { calls: 1 });
});

test("runKeyedJob: gagal dicatat FAILED lalu dicoba ulang", async () => {
  const job = `uji-${uniq()}`;
  assert.equal(await runKeyedJob(job, "global", "k", async () => { throw new Error("gagal sementara"); }, ctx()), "failed");
  const failed = await prisma.jobRun.findFirstOrThrow({ where: { job } });
  assert.equal(failed.status, "FAILED");
  assert.match(failed.error ?? "", /gagal sementara/);
  assert.equal(await runKeyedJob(job, "global", "k", async () => ({ ok: true }), ctx()), "ran");
  const retried = await prisma.jobRun.findFirstOrThrow({ where: { job } });
  assert.equal(retried.status, "SUCCEEDED");
  assert.equal(retried.attempts, 2);
});

test("runKeyedJob: RUNNING basi diambil alih, RUNNING segar dilewati", async () => {
  const job = `uji-${uniq()}`;
  await prisma.jobRun.create({ data: { job, scopeKey: "global", runKey: "a", status: "RUNNING", startedAt: new Date(Date.now() - 20 * 60_000) } });
  assert.equal(await runKeyedJob(job, "global", "a", async () => ({}), ctx()), "ran");
  await prisma.jobRun.create({ data: { job, scopeKey: "global", runKey: "b", status: "RUNNING", startedAt: new Date() } });
  assert.equal(await runKeyedJob(job, "global", "b", async () => ({}), ctx()), "skipped");
});

test("dua eksekusi bersamaan pada kunci sama -> hanya satu yang jalan", async () => {
  const job = `uji-${uniq()}`;
  const slow = async () => {
    await new Promise((r) => setTimeout(r, 50));
    return {};
  };
  const outcomes = await Promise.all([runKeyedJob(job, "global", "x", slow, ctx()), runKeyedJob(job, "global", "x", slow, ctx())]);
  assert.deepEqual(outcomes.sort(), ["ran", "skipped"]);
});

test("runQueueJob menjalankan fungsi dan menangkap error", async () => {
  assert.equal(await runQueueJob(`q-${uniq()}`, async () => ({}), ctx()), "ran");
  assert.equal(await runQueueJob(`q-${uniq()}`, async () => { throw new Error("x"); }, ctx()), "failed");
});

/**
 * Endpoint tick lewat route asli (secret, runner, semua job jatuh tempo), tetapi setiap job dibatasi cakupan
 * kosong: DB uji dipakai ulang (ribuan sekolah sisa test lain) sehingga tick tanpa cakupan memindai semuanya.
 */
test("endpoint tick dengan secret benar menjalankan job (cakupan uji kosong) dan mencatat lastTickAt", async () => {
  process.env.JOB_SECRET = "rahasia-job-uji-integrasi-0123456789abcd";
  resetEnvCache();
  setTickScopeForTests({ schoolIds: [], userIds: [] });
  try {
    const res = await callRoute<{ data: { results: Array<{ job: string; outcome: string }> } }>(POST, {
      method: "POST",
      url: "/api/internal/jobs/tick",
      headers: { "x-job-secret": process.env.JOB_SECRET },
      params: { job: "tick" },
    });
    assert.equal(res.status, 200);
    assert.ok(getLastTickAt());
    const outcomes = res.body?.data.results ?? [];
    assert.ok(outcomes.some((r) => r.job === "attendance-auto-alpha"), JSON.stringify(outcomes));
    assert.equal(outcomes.some((r) => r.outcome === "failed"), false, JSON.stringify(outcomes));
    const single = await runSingleJob("attendance-auto-alpha", new Date(), uniq("req"));
    assert.deepEqual(single.results.map((r) => [r.job, r.outcome]), [["attendance-auto-alpha", "ran"]]);
  } finally {
    setTickScopeForTests(undefined);
  }
});
