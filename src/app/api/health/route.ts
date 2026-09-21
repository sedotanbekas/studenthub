import { access, constants } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getLastTickAt } from "@/lib/jobs/tick";
import { log, safeErrorFields } from "@/lib/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness + kesiapan: DB, direktori storage, dan tick cron terakhir. Versi = git sha deploy. */
export async function GET(): Promise<Response> {
  const env = getEnv();
  const [db, storage] = await Promise.all([checkDb(), checkStorage(env.STORAGE_ROOT)]);
  const healthy = db && storage;
  const body = {
    status: healthy ? "ok" : "degraded",
    version: env.APP_VERSION,
    db: db ? "ok" : "down",
    storage: storage ? "ok" : "down",
    lastTickAt: getLastTickAt()?.toISOString() ?? null,
  };
  return Response.json(body, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

async function checkDb(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch (error) {
    log.error("health.db", safeErrorFields(error));
    return false;
  }
}

async function checkStorage(root: string): Promise<boolean> {
  try {
    await access(path.resolve(/*turbopackIgnore: true*/ root), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
