import type { JobContext } from "@/lib/auth/principal";

/** Seluruh job terjadwal. Urutan ini juga urutan eksekusi & pelaporan dalam satu tick. */
export const JOB_NAMES = ["push-dispatch", "attendance-auto-alpha", "files-orphan-cleanup", "maintenance-daily"] as const;

export type JobName = (typeof JOB_NAMES)[number];

/** Ringkasan hasil job (hitungan), disimpan sebagai JSON di JobRun.result. */
export type JobResult = Record<string, unknown>;

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

export type JobOutcome = "ran" | "skipped" | "failed";

const JOB_NAME_SET: ReadonlySet<string> = new Set(JOB_NAMES);

export function isJobName(value: string): value is JobName {
  return JOB_NAME_SET.has(value);
}
