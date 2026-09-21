import { wibDate } from "@/lib/time/zone";
import { DAILY_MAINTENANCE_UTC_HOUR } from "./constants";
import { JOB_NAMES, type JobName } from "./types";

/**
 * Jadwal job (murni, tanpa Prisma; jam disuntik lewat `now`).
 * - EVERY_TICK: tipe antrean, aman dijalankan dua kali, tanpa JobRun (runKey null).
 *   attendance-auto-alpha memberi kunci JobRun sendiri per sekolah/tanggal di dalam handler.
 * - HOURLY: dikunci per jam UTC ("YYYY-MM-DDTHH").
 * - DAILY: dikunci per tanggal WIB, jatuh tempo mulai tick pertama >= 19:00 UTC (02:00 WIB).
 */
type Cadence = "EVERY_TICK" | "HOURLY" | "DAILY";

const JOB_CADENCE: Readonly<Record<JobName, Cadence>> = {
  "push-dispatch": "EVERY_TICK",
  "attendance-auto-alpha": "EVERY_TICK",
  "files-orphan-cleanup": "HOURLY",
  "maintenance-daily": "DAILY",
};

export type DueJob = { readonly name: JobName; readonly runKey: string | null };

/** Kunci jam UTC, mis. "2026-09-21T19". */
export function hourKey(now: Date): string {
  return now.toISOString().slice(0, 13);
}

/** runKey JobRun untuk job pada instant `now` (null = job tipe antrean). Dipakai juga eksekusi manual. */
export function runKeyFor(name: JobName, now: Date): string | null {
  switch (JOB_CADENCE[name]) {
    case "EVERY_TICK":
      return null;
    case "HOURLY":
      return hourKey(now);
    case "DAILY":
      return wibDate(now);
  }
}

function isDue(cadence: Cadence, now: Date): boolean {
  return cadence !== "DAILY" || now.getUTCHours() >= DAILY_MAINTENANCE_UTC_HOUR;
}

/** Job yang jatuh tempo pada tick `now`, berurutan sesuai JOB_NAMES. */
export function dueJobs(now: Date): DueJob[] {
  return JOB_NAMES.filter((name) => isDue(JOB_CADENCE[name], now)).map((name) => ({ name, runKey: runKeyFor(name, now) }));
}
