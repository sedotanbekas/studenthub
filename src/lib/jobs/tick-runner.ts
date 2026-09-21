import type { JobContext } from "@/lib/auth/principal";
import { log, safeErrorFields } from "@/lib/log";
import { GLOBAL_SCOPE_KEY, TICK_BUDGET_MS } from "./constants";
import { dueJobs, runKeyFor, type DueJob } from "./schedule";
import type { JobHandler, JobName, JobOutcome, JobResult } from "./types";

/**
 * Orkestrasi tick (desain 05 J1) dengan dependensi yang disuntik agar bisa diuji tanpa DB.
 * Pengikatan ke Prisma/registry ada di tick.ts.
 */

export type TickJobReport = { readonly job: JobName; readonly outcome: JobOutcome; readonly ms: number };
export type TickResult = { readonly tickAt: string; readonly results: readonly TickJobReport[] };

type JobFn = () => Promise<JobResult>;

export interface TickDeps {
  readonly handlers: Readonly<Record<JobName, JobHandler>>;
  readonly runKeyed: (job: string, scopeKey: string, runKey: string, fn: JobFn, ctx: JobContext) => Promise<JobOutcome>;
  readonly runQueue: (name: string, fn: JobFn, ctx: JobContext) => Promise<JobOutcome>;
  /** Dipanggil di awal setiap tick cron (tidak untuk eksekusi manual). */
  readonly onTick?: (at: Date) => void;
  /** Jam monoton (ms) untuk mengukur durasi; bawaan performance.now(). */
  readonly elapsed?: () => number;
  /** Cakupan JobContext.scope (hanya test integrasi); undefined = seluruh database. */
  readonly scope?: () => JobContext["scope"] | undefined;
}

export interface TickRunner {
  runTick(now: Date, requestId: string): Promise<TickResult>;
  runSingleJob(name: JobName, now: Date, requestId: string): Promise<TickResult>;
}

const monotonic = (): number => performance.now();

function dispatch(deps: TickDeps, due: DueJob, ctx: JobContext): Promise<JobOutcome> {
  const handler = deps.handlers[due.name];
  const fn: JobFn = () => handler(ctx);
  return due.runKey === null
    ? deps.runQueue(due.name, fn, ctx)
    : deps.runKeyed(due.name, GLOBAL_SCOPE_KEY, due.runKey, fn, ctx);
}

/** Jalankan satu job dan ukur durasinya. Tidak pernah menolak: error tak terduga → "failed". */
async function timed(deps: TickDeps, due: DueJob, ctx: JobContext, clock: () => number): Promise<TickJobReport> {
  const started = clock();
  const outcome = await Promise.resolve()
    .then(() => dispatch(deps, due, ctx))
    .catch((error: unknown): JobOutcome => {
      log.error("Job gagal tak terduga", { job: due.name, requestId: ctx.requestId, ...safeErrorFields(error) });
      return "failed";
    });
  return { job: due.name, outcome, ms: Math.round(clock() - started) };
}

async function runJobs(deps: TickDeps, jobs: readonly DueJob[], now: Date, requestId: string): Promise<TickResult> {
  const clock = deps.elapsed ?? monotonic;
  const scope = deps.scope?.();
  const ctx: JobContext = { now, requestId, deadline: now.getTime() + TICK_BUDGET_MS, ...(scope ? { scope } : {}) };
  // Semantik allSettled: timed() tidak pernah menolak, jadi satu job gagal tidak menghentikan yang lain.
  const results = await Promise.all(jobs.map((due) => timed(deps, due, ctx, clock)));
  return { tickAt: now.toISOString(), results };
}

export function createTickRunner(deps: TickDeps): TickRunner {
  return {
    async runTick(now, requestId) {
      deps.onTick?.(now);
      const result = await runJobs(deps, dueJobs(now), now, requestId);
      log.info("Tick selesai", { requestId, tickAt: result.tickAt, results: result.results });
      return result;
    },
    async runSingleJob(name, now, requestId) {
      const result = await runJobs(deps, [{ name, runKey: runKeyFor(name, now) }], now, requestId);
      log.info("Job manual selesai", { requestId, tickAt: result.tickAt, results: result.results });
      return result;
    },
  };
}
