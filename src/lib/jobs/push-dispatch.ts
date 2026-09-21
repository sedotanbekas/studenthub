import type { JobContext } from "@/lib/auth/principal";
import { registerPushDispatcher } from "@/lib/push/kick";
import { kickContext, runPushDispatch } from "@/lib/push/runner";
import type { JobResult } from "./types";

/**
 * Job "push-dispatch" (setiap tick) + pendaftaran kick. Modul ini dimuat malas oleh registry.ts; saat
 * dimuat, kickPushDispatch (dipanggil notify lewat ctx.defer setelah respons) mulai benar-benar mengirim.
 * Sebelum itu notifikasi tetap PENDING di outbox dan dikirim tick berikutnya (<= 1 menit).
 */
export async function runPushDispatchJob(ctx: JobContext): Promise<JobResult> {
  const summary = await runPushDispatch(() => ctx);
  return { ...summary };
}

async function kick(): Promise<void> {
  await runPushDispatch(kickContext);
}

registerPushDispatcher(kick);
