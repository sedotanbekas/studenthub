import type { JobContext } from "@/lib/auth/principal";
import { log, safeErrorFields } from "@/lib/log";
import { decideJobRunTakeover, errorMessageOf, isUniqueViolation, toJsonResult, type JobRunState } from "./rules";
import type { JobOutcome, JobResult } from "./types";

/**
 * Inti runner job berkunci (desain 05 J3), terpisah dari Prisma agar bisa diuji dengan store palsu.
 * Mutex lintas proses = baris JobRun @@unique(job, scopeKey, runKey); kepemilikan = (id, startedAt).
 */

export type JobRunKey = { readonly job: string; readonly scopeKey: string; readonly runKey: string };
export type JobRunSnapshot = JobRunState & { readonly id: string };
export type JobRunClaim = { readonly id: string; readonly startedAt: Date };
export type JobRunFinish =
  | { readonly status: "SUCCEEDED"; readonly finishedAt: Date; readonly result: JobResult }
  | { readonly status: "FAILED"; readonly finishedAt: Date; readonly error: string };

export interface JobRunStore {
  /** INSERT baris RUNNING (attempts 1). Melempar error P2002 bila kunci sudah ada. */
  create(key: JobRunKey, startedAt: Date): Promise<JobRunClaim>;
  findByKey(key: JobRunKey): Promise<JobRunSnapshot | null>;
  /**
   * Compare-and-set ke RUNNING (attempts+1, startedAt baru). RETRY: syarat status FAILED.
   * TAKEOVER: syarat status RUNNING dan startedAt lama. null bila kalah balapan.
   */
  reclaim(existing: JobRunSnapshot, mode: "RETRY" | "TAKEOVER", startedAt: Date): Promise<JobRunClaim | null>;
  /** Tulis status akhir hanya bila masih pemilik (RUNNING + startedAt klaim). false bila sudah diambil alih. */
  finish(claim: JobRunClaim, patch: JobRunFinish): Promise<boolean>;
}

type Settled<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: unknown };
type LogFields = Readonly<Record<string, unknown>>;

const settle = <T>(run: () => Promise<T>): Promise<Settled<T>> =>
  Promise.resolve()
    .then(run)
    .then(
      (value): Settled<T> => ({ ok: true, value }),
      (error: unknown): Settled<T> => ({ ok: false, error }),
    );

const systemClock = (): Date => new Date();

async function claimJobRun(store: JobRunStore, key: JobRunKey, now: Date): Promise<JobRunClaim | null> {
  try {
    return await store.create(key, now);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
  const existing = await store.findByKey(key);
  if (!existing) return null;
  const decision = decideJobRunTakeover(existing, now);
  return decision === "SKIP" ? null : store.reclaim(existing, decision, now);
}

/** Tulis status akhir. false hanya bila penulisan melempar (DB bermasalah). */
async function finishSafely(store: JobRunStore, claim: JobRunClaim, patch: JobRunFinish, fields: LogFields): Promise<boolean> {
  const written = await settle(() => store.finish(claim, patch));
  if (!written.ok) {
    log.error("Gagal menulis status akhir JobRun", { ...fields, status: patch.status, ...safeErrorFields(written.error) });
    return false;
  }
  if (!written.value) log.warn("JobRun sudah diambil alih proses lain; status akhir tidak ditulis", { ...fields, status: patch.status });
  return true;
}

async function runClaimed(
  store: JobRunStore,
  claim: JobRunClaim,
  fn: () => Promise<JobResult>,
  fields: LogFields,
  clock: () => Date,
): Promise<JobOutcome> {
  const attempt = await settle(fn);
  if (!attempt.ok) {
    log.error("Job gagal", { ...fields, ...safeErrorFields(attempt.error) });
    await finishSafely(store, claim, { status: "FAILED", finishedAt: clock(), error: errorMessageOf(attempt.error) }, fields);
    return "failed";
  }
  const patch: JobRunFinish = { status: "SUCCEEDED", finishedAt: clock(), result: toJsonResult(attempt.value) };
  return (await finishSafely(store, claim, patch, fields)) ? "ran" : "failed";
}

/**
 * Jalankan `fn` paling banyak sekali per kunci (job, scopeKey, runKey), dengan retry FAILED
 * (maks. JOB_MAX_ATTEMPTS) dan pengambilalihan RUNNING basi. Tidak pernah melempar.
 */
export async function executeKeyedJob(
  store: JobRunStore,
  key: JobRunKey,
  fn: () => Promise<JobResult>,
  ctx: JobContext,
  clock: () => Date = systemClock,
): Promise<JobOutcome> {
  const fields: LogFields = { job: key.job, scopeKey: key.scopeKey, runKey: key.runKey, requestId: ctx.requestId };
  const claimed = await settle(() => claimJobRun(store, key, ctx.now));
  if (!claimed.ok) {
    log.error("Gagal mengklaim JobRun", { ...fields, ...safeErrorFields(claimed.error) });
    return "failed";
  }
  if (!claimed.value) {
    log.debug("JobRun dilewati", fields);
    return "skipped";
  }
  return runClaimed(store, claimed.value, fn, fields, clock);
}
