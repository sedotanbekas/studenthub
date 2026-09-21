import type { JobContext } from "@/lib/auth/principal";
import { log, safeErrorFields } from "@/lib/log";
import type { JobOutcome, JobResult } from "./types";

/**
 * Nama job tipe antrean yang sedang berjalan di proses ini. Mutex in-process cukup karena
 * aplikasi berjalan sebagai SATU proses PM2 fork (desain 05 D29); job antrean aman dijalankan
 * dua kali, mutex ini hanya mencegah tumpukan tick yang saling menyusul.
 */
const running = new Set<string>();

/**
 * Jalankan job tipe antrean (tanpa baris JobRun). Bila job bernama sama dari tick sebelumnya
 * masih berjalan → "skipped". Error dicatat dan menjadi "failed"; tidak pernah melempar.
 */
export async function runQueueJob(name: string, fn: () => Promise<JobResult>, ctx: JobContext): Promise<JobOutcome> {
  if (running.has(name)) {
    log.info("Job antrean masih berjalan; tick ini dilewati", { job: name, requestId: ctx.requestId });
    return "skipped";
  }
  running.add(name);
  try {
    await fn();
    return "ran";
  } catch (error) {
    log.error("Job gagal", { job: name, requestId: ctx.requestId, ...safeErrorFields(error) });
    return "failed";
  } finally {
    running.delete(name);
  }
}
