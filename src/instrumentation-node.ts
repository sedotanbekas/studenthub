import path from "node:path";
import { getEnv } from "./lib/env";
import { log } from "./lib/log";

/**
 * Asersi boot runtime Node: TZ=UTC, env valid, dan (produksi) STORAGE_ROOT di luar folder aplikasi
 * (folder app di-reset setiap deploy). Pelanggaran di produksi menghentikan start.
 */
export function assertBootInvariants(): void {
  const env = getEnv();
  const problems: string[] = [];
  if (new Date().getTimezoneOffset() !== 0) problems.push("Proses harus berjalan dengan TZ=UTC");
  const storage = path.resolve(/*turbopackIgnore: true*/ env.STORAGE_ROOT);
  const appDir = path.resolve(/*turbopackIgnore: true*/ process.cwd());
  if (storage === appDir || storage.startsWith(appDir + path.sep)) {
    problems.push("STORAGE_ROOT harus berada di luar folder aplikasi");
  }
  for (const message of problems) {
    if (env.NODE_ENV === "production") throw new Error(message);
    log.warn("boot.check", { message });
  }
  log.info("boot", { version: env.APP_VERSION, nodeEnv: env.NODE_ENV, pushTransport: env.PUSH_TRANSPORT });
}
