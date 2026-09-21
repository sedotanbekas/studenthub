import type { JobContext } from "@/lib/auth/principal";
import { prisma, type Prisma } from "@/lib/db";
import { executeKeyedJob, type JobRunClaim, type JobRunFinish, type JobRunStore } from "./keyed";
import type { JobOutcome, JobResult } from "./types";

export { JOB_MAX_ATTEMPTS, JOB_STALE_MS } from "./constants";
export { decideJobRunTakeover } from "./rules";
export { runQueueJob } from "./queue";

const SNAPSHOT_SELECT = { id: true, status: true, startedAt: true, attempts: true } as const;

function finishData(patch: JobRunFinish): Prisma.JobRunUpdateManyMutationInput {
  return patch.status === "SUCCEEDED"
    ? { status: "SUCCEEDED", finishedAt: patch.finishedAt, result: patch.result as Prisma.InputJsonObject, error: null }
    : { status: "FAILED", finishedAt: patch.finishedAt, error: patch.error };
}

/** Store JobRun berbasis Prisma: semua transisi memakai compare-and-set updateMany. */
const prismaJobRunStore: JobRunStore = {
  async create(key, startedAt) {
    const row = await prisma.jobRun.create({
      data: { ...key, status: "RUNNING", attempts: 1, startedAt },
      select: { id: true },
    });
    return { id: row.id, startedAt };
  },

  findByKey(key) {
    return prisma.jobRun.findUnique({ where: { job_scopeKey_runKey: key }, select: SNAPSHOT_SELECT });
  },

  async reclaim(existing, mode, startedAt): Promise<JobRunClaim | null> {
    const where: Prisma.JobRunWhereInput =
      mode === "RETRY"
        ? { id: existing.id, status: "FAILED" }
        : { id: existing.id, status: "RUNNING", startedAt: existing.startedAt };
    const { count } = await prisma.jobRun.updateMany({
      where,
      data: { status: "RUNNING", attempts: { increment: 1 }, startedAt, finishedAt: null },
    });
    return count === 1 ? { id: existing.id, startedAt } : null;
  },

  async finish(claim, patch) {
    const { count } = await prisma.jobRun.updateMany({
      where: { id: claim.id, status: "RUNNING", startedAt: claim.startedAt },
      data: finishData(patch),
    });
    return count === 1;
  },
};

/**
 * Jalankan job berkunci sekali per (job, scopeKey, runKey), mis. ("files-orphan-cleanup",
 * "global", "2026-09-21T19") atau ("attendance-auto-alpha", <schoolId>, "2026-09-21").
 * FAILED dicoba ulang hingga JOB_MAX_ATTEMPTS; RUNNING > JOB_STALE_MS diambil alih.
 */
export function runKeyedJob(
  job: string,
  scopeKey: string,
  runKey: string,
  fn: () => Promise<JobResult>,
  ctx: JobContext,
): Promise<JobOutcome> {
  return executeKeyedJob(prismaJobRunStore, { job, scopeKey, runKey }, fn, ctx);
}
