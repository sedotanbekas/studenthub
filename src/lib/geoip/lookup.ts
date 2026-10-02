import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Reader } from "mmdb-lib";
import { log, safeErrorFields } from "@/lib/log";
import { storageRoot } from "@/lib/storage/driver";
import { GEOIP_FILES, geoIpDirIn } from "./files";
import { toGeoInfo, type GeoInfo, type GeoKind } from "./rules";

/**
 * Perkiraan lokasi + ISP dari IP memakai berkas DB-IP Lite lokal (tanpa mengirim IP ke pihak ketiga).
 * Kedua berkas (~140 MB) dimuat sekali dan dipakai ulang selama cap berkasnya (mtime + ukuran) sama; berkas
 * yang muncul/diganti `pnpm geoip:update` setelah proses berjalan langsung dimuat ulang pada pencarian
 * berikutnya. Dilepas setelah IDLE_RELEASE_MS tanpa pencarian. Berkas belum ada / IP privat / gagal baca ->
 * null. Tidak pernah melempar: login tidak boleh gagal karena lokasi.
 */
const IDLE_RELEASE_MS = 15 * 60_000;
const KINDS: readonly GeoKind[] = ["city", "asn"];
const MISSING = "missing";

/** Bagian Reader mmdb-lib yang dipakai (bisa dipalsukan di test). */
export interface GeoReader {
  get(ip: string): unknown;
}

export type GeoOpener = (file: string) => Promise<GeoReader>;
type Readers = Readonly<Record<GeoKind, GeoReader | null>>;

export interface GeoLookup {
  lookup(ip: string | null): Promise<GeoInfo | null>;
  release(): void;
}

async function readMmdb(file: string): Promise<GeoReader> {
  return new Reader(await readFile(file));
}

/** Cap berkas: berubah saat berkas muncul, hilang, atau diganti. */
async function stampOf(file: string): Promise<string> {
  try {
    const info = await stat(file);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return MISSING;
  }
}

async function openOne(open: GeoOpener, file: string, stamp: string, kind: GeoKind): Promise<GeoReader | null> {
  if (stamp === MISSING) return null;
  try {
    return await open(file);
  } catch (error) {
    log.warn("geoip.open_failed", { kind, ...safeErrorFields(error) });
    return null;
  }
}

function safeGet(reader: GeoReader | null, ip: string): unknown {
  try {
    return reader?.get(ip) ?? null;
  } catch {
    return null;
  }
}

async function openReaders(open: GeoOpener, files: Readonly<Record<GeoKind, string>>, stamps: Readonly<Record<GeoKind, string>>): Promise<Readers> {
  const [city, asn] = await Promise.all(KINDS.map((kind) => openOne(open, files[kind], stamps[kind], kind)));
  return { city: city ?? null, asn: asn ?? null };
}

/** `dir` dibaca saat dibutuhkan (env belum tentu siap saat modul dimuat); `open` bisa diganti di test. */
export function createGeoLookup(dir: () => string, open: GeoOpener = readMmdb): GeoLookup {
  let cached: { readonly stamp: string; readonly readers: Promise<Readers> } | null = null;
  let timer: NodeJS.Timeout | null = null;
  const release = (): void => {
    cached = null;
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const readers = async (): Promise<Readers> => {
    const base = dir();
    const files = { city: path.join(base, GEOIP_FILES.city), asn: path.join(base, GEOIP_FILES.asn) };
    const stamps = { city: await stampOf(files.city), asn: await stampOf(files.asn) };
    const stamp = `${stamps.city}|${stamps.asn}`;
    if (cached?.stamp !== stamp) cached = { stamp, readers: openReaders(open, files, stamps) };
    if (timer) clearTimeout(timer);
    timer = setTimeout(release, IDLE_RELEASE_MS);
    timer.unref();
    return cached.readers;
  };
  return {
    async lookup(ip) {
      if (!ip) return null;
      const { city, asn } = await readers();
      return toGeoInfo(safeGet(city, ip), safeGet(asn, ip));
    },
    release,
  };
}

const shared = createGeoLookup(() => geoIpDirIn(storageRoot()));

export function lookupIp(ip: string | null): Promise<GeoInfo | null> {
  return shared.lookup(ip);
}
