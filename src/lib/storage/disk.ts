import { statfs } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@/lib/http/errors";
import { log } from "@/lib/log";

/**
 * Penjaga disk: tolak unggahan (503) bila ruang bebas di bawah ambang, agar storage tidak
 * memenuhi disk yang juga dipakai MariaDB & aplikasi lain di VPS.
 */
export const MIN_FREE_DISK_BYTES = 5 * 1024 ** 3;

/** Subset hasil fs.statfs yang dibutuhkan (dapat diinjeksi untuk test). */
export type StatFsFn = (dir: string) => Promise<{ bavail: number | bigint; bsize: number | bigint }>;

function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/** Ruang bebas (byte) untuk pengguna non-root pada filesystem `dir`; root yang belum ada → leluhur terdekat. */
export async function getFreeDiskBytes(dir: string, statfsFn: StatFsFn = statfs): Promise<number> {
  const target = path.resolve(/*turbopackIgnore: true*/ dir);
  try {
    const s = await statfsFn(target);
    return Number(s.bavail) * Number(s.bsize);
  } catch (err) {
    const parent = path.dirname(target);
    if (hasCode(err, "ENOENT") && parent !== target) return getFreeDiskBytes(parent, statfsFn);
    throw err;
  }
}

export async function assertDiskSpace(
  root: string,
  minFreeBytes: number = MIN_FREE_DISK_BYTES,
  statfsFn: StatFsFn = statfs,
): Promise<void> {
  const freeBytes = await getFreeDiskBytes(root, statfsFn);
  if (freeBytes >= minFreeBytes) return;
  log.warn("storage.disk_low", { freeBytes, minFreeBytes });
  throw new AppError(503, "SERVICE_UNAVAILABLE", "Penyimpanan server hampir penuh. Hubungi admin.");
}
