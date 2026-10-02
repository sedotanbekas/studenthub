/**
 * Unduh/perbarui berkas DB-IP Lite (perkiraan lokasi IP di riwayat masuk super admin) ke
 * <STORAGE_ROOT>/geoip. Dijalankan otomatis di akhir deploy (scripts/deploy/remote-deploy.sh, tidak fatal);
 * aman diulang — rilis bulan yang sudah terpasang tidak diunduh lagi.
 *
 *   pnpm geoip:update
 */
import { resolve } from "node:path";
import { geoIpDirIn } from "../src/lib/geoip/files";
import { updateGeoIpDatabases } from "../src/lib/geoip/update";
import { exitWithError, loadDotEnv } from "./deploy/cli-env";

async function main(): Promise<void> {
  loadDotEnv();
  const raw = process.env.STORAGE_ROOT?.trim();
  if (!raw) exitWithError("geoip-update", "STORAGE_ROOT tidak ditemukan di lingkungan maupun .env");
  const results = await updateGeoIpDatabases({ dir: geoIpDirIn(resolve(raw)), now: new Date() });
  for (const result of results) {
    const detail = result.outcome === "failed" ? result.error : `rilis ${result.month}`;
    console.log(`geoip ${result.kind}: ${result.outcome} (${detail})`);
  }
  process.exit(results.some((result) => result.outcome === "failed") ? 1 : 0);
}

void main();
