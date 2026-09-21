import { getLastTickAt, recordTick } from "./heartbeat";
import { JOB_HANDLERS } from "./registry";
import { runKeyedJob, runQueueJob } from "./runner";
import { createTickRunner, type TickResult } from "./tick-runner";
import type { JobName } from "./types";

export type { TickJobReport, TickResult } from "./tick-runner";
export { getLastTickAt };

const defaultRunner = createTickRunner({
  handlers: JOB_HANDLERS,
  runKeyed: runKeyedJob,
  runQueue: runQueueJob,
  onTick: recordTick,
});

/**
 * Jalankan semua job yang jatuh tempo pada `now` (Promise.allSettled). Job berkunci lewat
 * runKeyedJob(name, "global", runKey), job antrean lewat runQueueJob. Deadline = now + 50 detik.
 */
export function runTick(now: Date, requestId: string): Promise<TickResult> {
  return defaultRunner.runTick(now, requestId);
}

/**
 * Jalankan satu job secara manual dengan runKey yang sama seperti penjadwal (idempoten: job
 * berkunci yang sudah SUCCEEDED untuk jam/tanggal ini dilaporkan "skipped"). Tidak mengubah lastTickAt.
 */
export function runSingleJob(name: JobName, now: Date, requestId: string): Promise<TickResult> {
  return defaultRunner.runSingleJob(name, now, requestId);
}
