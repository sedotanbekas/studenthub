import { getEnv } from "@/lib/env";
import { handleJobRequest, type JobEndpointDeps } from "@/lib/jobs/endpoint";
import { runSingleJob, runTick } from "@/lib/jobs/tick";

/** Cron: POST 127.0.0.1/api/internal/jobs/tick tiap menit (header X-Job-Secret). nginx memblokir /api/internal/. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deps: JobEndpointDeps = { jobSecret: () => getEnv().JOB_SECRET, runTick, runSingleJob };

export async function POST(req: Request, { params }: { params: Promise<{ job: string }> }): Promise<Response> {
  const { job } = await params;
  return handleJobRequest(req, job, deps);
}
