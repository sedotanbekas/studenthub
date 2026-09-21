import { getLastTickAt, recordTick } from "./heartbeat";
import { JOB_HANDLERS } from "./registry";
import { runKeyedJob, runQueueJob } from "./runner";
import { createTickRunner, type TickResult } from "./tick-runner";
import type { JobName } from "./types";
import type { JobContext } from "@/lib/auth/principal";

export type { TickJobReport, TickResult } from "./tick-runner";
export { getLastTickAt };

let testScope: JobContext["scope"] | undefined;

/**
 * HANYA test integrasi: batasi cakupan setiap job pada tick/eksekusi manual (JobContext.scope) agar uji
 * endpoint tick tidak memindai seluruh DB uji yang dipakai ulang. Di luar NODE_ENV=test ditolak.
 */
export function setTickScopeForTests(scope: JobContext["scope"] | undefined): void {
  if (process.env.NODE_ENV !== "test") throw new Error("setTickScopeForTests hanya untuk test");
  testScope = scope;
}

const defaultRunner = createTickRunner({
  handlers: JOB_HANDLERS,
  runKeyed: runKeyedJob,
  runQueue: runQueueJob,
  onTick: recordTick,
  scope: () => testScope,
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
