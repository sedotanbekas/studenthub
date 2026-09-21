import type { JobRunStatus } from "@prisma/client";
import { JOB_ERROR_MAX_CHARS, JOB_MAX_ATTEMPTS, JOB_STALE_MS } from "./constants";
import type { JobResult } from "./types";

/** Aturan murni runner JobRun (tanpa Prisma; jam disuntik lewat `now`). */

export type JobRunState = { readonly status: JobRunStatus; readonly startedAt: Date; readonly attempts: number };
export type TakeoverDecision = "SKIP" | "RETRY" | "TAKEOVER";

/**
 * Keputusan saat INSERT JobRun bentrok (P2002) dengan baris yang sudah ada:
 * - SUCCEEDED → SKIP (sudah selesai untuk kunci ini).
 * - FAILED dan attempts < JOB_MAX_ATTEMPTS → RETRY.
 * - RUNNING dengan startedAt lebih tua dari JOB_STALE_MS → TAKEOVER (proses sebelumnya mati).
 * - Selain itu SKIP. Batas percobaan juga berlaku untuk TAKEOVER agar job yang selalu membuat
 *   proses crash tidak diulang tanpa henti.
 */
export function decideJobRunTakeover(existing: JobRunState, now: Date): TakeoverDecision {
  if (existing.attempts >= JOB_MAX_ATTEMPTS) return "SKIP";
  switch (existing.status) {
    case "FAILED":
      return "RETRY";
    case "RUNNING":
      return now.getTime() - existing.startedAt.getTime() > JOB_STALE_MS ? "TAKEOVER" : "SKIP";
    default:
      return "SKIP";
  }
}

/** Pesan error untuk kolom JobRun.error (maksimal JOB_ERROR_MAX_CHARS karakter). */
export function errorMessageOf(error: unknown): string {
  const text = error instanceof Error ? error.message || error.name : String(error);
  return text.slice(0, JOB_ERROR_MAX_CHARS);
}

/** true bila error adalah pelanggaran unik Prisma (P2002). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

const jsonReplacer = (_key: string, value: unknown): unknown => (typeof value === "bigint" ? value.toString() : value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Salinan JSON murni dari hasil job untuk kolom JobRun.result: Date → ISO, undefined dibuang,
 * BigInt → string. Hasil yang tidak bisa diserialisasi (mis. siklik) tidak boleh menggagalkan job.
 */
export function toJsonResult(result: JobResult): JobResult {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(result, jsonReplacer));
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    return { unserializable: true };
  }
}
