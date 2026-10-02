import path from "node:path";
import type { GeoKind } from "./rules";

/**
 * Berkas DB-IP Lite (MMDB) di `<STORAGE_ROOT>/geoip` — di luar repo, diisi `pnpm geoip:update` (langkah
 * terakhir setiap deploy, lihat scripts/deploy/remote-deploy.sh). VERSION.json mencatat bulan rilis tiap berkas.
 */
export const GEOIP_FILES: Readonly<Record<GeoKind, string>> = { city: "dbip-city-lite.mmdb", asn: "dbip-asn-lite.mmdb" };
export const GEOIP_VERSION_FILE = "VERSION.json";

export function geoIpDirIn(storageRootPath: string): string {
  return path.join(storageRootPath, "geoip");
}
