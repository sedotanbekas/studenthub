import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createGunzip } from "node:zlib";
import { Reader } from "mmdb-lib";
import { GEOIP_FILES, GEOIP_VERSION_FILE } from "./files";
import { dbipMonth, dbipUrl, isDbipDatabaseType, previousDbipMonth, type GeoKind } from "./rules";

/**
 * Pembaruan berkas DB-IP Lite (`pnpm geoip:update`, langkah terakhir deploy). Rilis bulan berjalan diunduh
 * bila belum terpasang (404 di awal bulan -> rilis bulan lalu), diekstrak ke `.tmp`, divalidasi jenis
 * MMDB-nya, lalu diganti atomik (rename). Kegagalan per jenis dilaporkan tanpa melempar dan berkas lama
 * tetap dipakai.
 */
const MAX_EXTRACTED_BYTES = 400 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 5 * 60_000;
const KINDS: readonly GeoKind[] = ["city", "asn"];

export type GeoIpUpdateResult =
  | { readonly kind: GeoKind; readonly outcome: "current" | "updated"; readonly month: string }
  | { readonly kind: GeoKind; readonly outcome: "failed"; readonly error: string };

export interface GeoIpUpdateOptions {
  readonly dir: string;
  readonly now: Date;
  readonly fetchImpl?: typeof fetch;
  /** Default: berkas harus MMDB DB-IP Lite dengan jenis yang sesuai. */
  readonly validate?: (kind: GeoKind, file: Buffer) => boolean;
}

type Versions = Partial<Record<GeoKind, string>>;

export function isValidDbipFile(kind: GeoKind, file: Buffer): boolean {
  try {
    return isDbipDatabaseType(kind, new Reader(file).metadata.databaseType);
  } catch {
    return false;
  }
}

async function readVersions(dir: string): Promise<Versions> {
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, GEOIP_VERSION_FILE), "utf8")) as Record<string, unknown>;
    return Object.fromEntries(KINDS.filter((kind) => typeof parsed[kind] === "string").map((kind) => [kind, parsed[kind]]));
  } catch {
    return {};
  }
}

const exists = (file: string): Promise<boolean> => stat(file).then(() => true, () => false);

function byteLimit(max: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length;
      callback(total > max ? new Error("Berkas DB-IP melebihi batas ukuran.") : null, chunk);
    },
  });
}

/** Unduh + ekstrak ke `tmp`; false bila rilis bulan itu belum ada (404). */
async function download(kind: GeoKind, month: string, tmp: string, fetchImpl: typeof fetch): Promise<boolean> {
  const response = await fetchImpl(dbipUrl(kind, month), { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (response.status === 404 || !response.ok) await response.body?.cancel();
  if (response.status === 404) return false;
  if (!response.ok || !response.body) throw new Error(`Unduhan DB-IP ${kind} ${month} gagal: HTTP ${response.status}.`);
  const body = Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>);
  await pipeline(body, createGunzip(), byteLimit(MAX_EXTRACTED_BYTES), createWriteStream(tmp));
  return true;
}

async function installLatest(kind: GeoKind, installed: string | undefined, options: GeoIpUpdateOptions): Promise<GeoIpUpdateResult> {
  const target = path.join(options.dir, GEOIP_FILES[kind]);
  const tmp = `${target}.tmp`;
  const latest = dbipMonth(options.now);
  for (const month of [latest, previousDbipMonth(latest)]) {
    if (installed === month) return { kind, outcome: "current", month };
    if (!(await download(kind, month, tmp, options.fetchImpl ?? fetch))) continue;
    if (!(options.validate ?? isValidDbipFile)(kind, await readFile(tmp))) throw new Error(`Berkas DB-IP ${kind} ${month} tidak valid.`);
    await rename(tmp, target);
    return { kind, outcome: "updated", month };
  }
  throw new Error(`Rilis DB-IP ${kind} ${latest} maupun bulan sebelumnya tidak ditemukan.`);
}

async function updateOne(kind: GeoKind, versions: Versions, options: GeoIpUpdateOptions): Promise<GeoIpUpdateResult> {
  const target = path.join(options.dir, GEOIP_FILES[kind]);
  const installed = (await exists(target)) ? versions[kind] : undefined;
  try {
    return await installLatest(kind, installed, options);
  } catch (error) {
    return { kind, outcome: "failed", error: error instanceof Error ? error.message : String(error) };
  } finally {
    await rm(`${target}.tmp`, { force: true });
  }
}

export async function updateGeoIpDatabases(options: GeoIpUpdateOptions): Promise<GeoIpUpdateResult[]> {
  await mkdir(options.dir, { recursive: true });
  const versions = await readVersions(options.dir);
  const results: GeoIpUpdateResult[] = [];
  for (const kind of KINDS) results.push(await updateOne(kind, versions, options));
  const updated = Object.fromEntries(results.flatMap((r) => (r.outcome === "updated" ? [[r.kind, r.month]] : [])));
  if (Object.keys(updated).length > 0) {
    await writeFile(path.join(options.dir, GEOIP_VERSION_FILE), JSON.stringify({ ...versions, ...updated }));
  }
  return results;
}
