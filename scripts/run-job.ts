/**
 * Menjalankan satu job cron secara manual (lokal/VPS), mis.: pnpm jobs:run attendance-auto-alpha
 * Memakai jalur yang sama dengan endpoint /api/internal/jobs/{job}.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { isJobName, JOB_NAMES } from "../src/lib/jobs/types";
import { runSingleJob, runTick } from "../src/lib/jobs/tick";

async function main(): Promise<void> {
  const name = process.argv[2];
  const now = new Date();
  if (name === "tick") {
    console.log(JSON.stringify(await runTick(now, randomUUID()), null, 2));
  } else if (name && isJobName(name)) {
    console.log(JSON.stringify(await runSingleJob(name, now, randomUUID()), null, 2));
  } else {
    console.error(`Pemakaian: pnpm jobs:run <tick|${JOB_NAMES.join("|")}>`);
    process.exit(1);
  }
  process.exit(0);
}

void main();
