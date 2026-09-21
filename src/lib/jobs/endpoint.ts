import { randomUUID } from "node:crypto";
import { fail, ok, type ErrorEnvelope, type SuccessEnvelope } from "@/lib/http/envelope";
import { log, safeErrorFields } from "@/lib/log";
import { TICK_JOB } from "./constants";
import { verifyJobSecret } from "./secret";
import type { TickResult } from "./tick-runner";
import { isJobName, type JobName } from "./types";

/**
 * Logika HTTP POST /api/internal/jobs/{job} (desain 05 J4), dipisah dari route.ts agar bisa
 * diuji tanpa DB. Tidak lewat defineRoute: tidak ada principal, autentikasi = X-Job-Secret.
 * Setiap kegagalan autentikasi dijawab 404 (bukan 401) agar endpoint tidak terdeteksi.
 */

export interface JobEndpointDeps {
  readonly jobSecret: () => string;
  readonly runTick: (now: Date, requestId: string) => Promise<TickResult>;
  readonly runSingleJob: (name: JobName, now: Date, requestId: string) => Promise<TickResult>;
  readonly now?: () => Date;
  readonly newRequestId?: () => string;
}

const JOB_SECRET_HEADER = "x-job-secret";
/** nginx selalu memasang X-Real-IP; cron memanggil 127.0.0.1 langsung tanpa header ini. */
const PROXY_HEADER = "x-real-ip";

function json(status: number, body: SuccessEnvelope<TickResult> | ErrorEnvelope, requestId: string): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": requestId },
  });
}

const notFound = (requestId: string): Response => json(404, fail("NOT_FOUND", "Tidak ditemukan."), requestId);

function rejectReason(req: Request, deps: JobEndpointDeps): string | null {
  if (req.headers.has(PROXY_HEADER)) return "lewat-proxy";
  if (!verifyJobSecret(req.headers.get(JOB_SECRET_HEADER), deps.jobSecret())) return "secret-tidak-valid";
  return null;
}

function runJob(job: string, deps: JobEndpointDeps, now: Date, requestId: string): Promise<TickResult> | null {
  if (job === TICK_JOB) return deps.runTick(now, requestId);
  if (isJobName(job)) return deps.runSingleJob(job, now, requestId);
  return null;
}

export async function handleJobRequest(req: Request, job: string, deps: JobEndpointDeps): Promise<Response> {
  const requestId = (deps.newRequestId ?? randomUUID)();
  try {
    const reason = rejectReason(req, deps);
    if (reason) {
      log.warn("Permintaan job internal ditolak", { requestId, reason });
      return notFound(requestId);
    }
    const running = runJob(job, deps, (deps.now ?? (() => new Date()))(), requestId);
    return running ? json(200, ok(await running), requestId) : notFound(requestId);
  } catch (error) {
    log.error("Endpoint job internal gagal", { requestId, job, ...safeErrorFields(error) });
    return json(500, fail("INTERNAL_ERROR", "Terjadi kesalahan pada server.", null, requestId), requestId);
  }
}
