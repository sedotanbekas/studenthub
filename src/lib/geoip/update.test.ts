import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { GEOIP_FILES, GEOIP_VERSION_FILE } from "./files";
import type { GeoKind } from "./rules";
import { updateGeoIpDatabases } from "./update";

const NOW = new Date("2026-10-02T03:00:00Z");
/** Isi berkas palsu "<kind>@<bulan>"; validator uji menerima awalan jenis yang benar. */
const validate = (kind: GeoKind, file: Buffer): boolean => file.toString().startsWith(`${kind}@`);

function fakeFetch(available: ReadonlySet<string>, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const match = /dbip-(city|asn)-lite-(\d{4}-\d{2})\.mmdb\.gz$/.exec(url);
    const key = match ? `${match[1]}@${match[2]}` : "";
    if (!available.has(key)) return new Response("not found", { status: 404 });
    return new Response(gzipSync(Buffer.from(key)), { status: 200 });
  }) as typeof fetch;
}

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-"));
  try {
    await run(path.join(dir, "geoip"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const contentOf = (dir: string, kind: GeoKind) => readFile(path.join(dir, GEOIP_FILES[kind]), "utf8");

test("updateGeoIpDatabases: folder kosong -> unduh rilis bulan ini, catat VERSION.json", () =>
  withDir(async (dir) => {
    const results = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: fakeFetch(new Set(["city@2026-10", "asn@2026-10"])) });
    assert.deepEqual(results, [
      { kind: "city", outcome: "updated", month: "2026-10" },
      { kind: "asn", outcome: "updated", month: "2026-10" },
    ]);
    assert.equal(await contentOf(dir, "city"), "city@2026-10");
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, GEOIP_VERSION_FILE), "utf8")), { city: "2026-10", asn: "2026-10" });
  }));

test("updateGeoIpDatabases: sudah versi bulan ini -> tidak mengunduh ulang", () =>
  withDir(async (dir) => {
    const available = new Set(["city@2026-10", "asn@2026-10"]);
    await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: fakeFetch(available) });
    const calls: string[] = [];
    const again = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: fakeFetch(available, calls) });
    assert.deepEqual(again.map((r) => r.outcome), ["current", "current"]);
    assert.equal(calls.length, 0);
  }));

test("updateGeoIpDatabases: rilis bulan ini belum terbit (404) -> pakai bulan sebelumnya", () =>
  withDir(async (dir) => {
    const results = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: fakeFetch(new Set(["city@2026-09", "asn@2026-09"])) });
    assert.deepEqual(results.map((r) => (r.outcome === "failed" ? r.outcome : r.month)), ["2026-09", "2026-09"]);
    const calls: string[] = [];
    const again = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: fakeFetch(new Set(["city@2026-09", "asn@2026-09"]), calls) });
    assert.deepEqual(again.map((r) => r.outcome), ["current", "current"], "bulan lalu tetap dianggap terkini selama rilis baru belum ada");
    assert.equal(calls.length, 2, "hanya mengecek rilis bulan ini");
  }));

test("updateGeoIpDatabases: berkas rusak ditolak, berkas lama tetap utuh, tanpa sisa .tmp", () =>
  withDir(async (dir) => {
    await updateGeoIpDatabases({ dir, now: new Date("2026-09-15T00:00:00Z"), validate, fetchImpl: fakeFetch(new Set(["city@2026-09", "asn@2026-09"])) });
    const broken = (async () => new Response(gzipSync(Buffer.from("rusak")), { status: 200 })) as typeof fetch;
    const results = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: broken });
    assert.deepEqual(results.map((r) => r.outcome), ["failed", "failed"]);
    assert.equal(await contentOf(dir, "city"), "city@2026-09");
    assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), []);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, GEOIP_VERSION_FILE), "utf8")), { city: "2026-09", asn: "2026-09" });
  }));

test("updateGeoIpDatabases: rilis tidak ditemukan atau jaringan gagal -> failed per jenis (tidak melempar)", () =>
  withDir(async (dir) => {
    const results = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: fakeFetch(new Set(["city@2026-10"])) });
    assert.equal(results[0]?.outcome, "updated");
    assert.equal(results[1]?.outcome, "failed");
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await writeFile(path.join(dir, GEOIP_VERSION_FILE), "{bukan json");
    const down = await updateGeoIpDatabases({ dir, now: NOW, validate, fetchImpl: offline });
    assert.deepEqual(down.map((r) => r.outcome), ["failed", "failed"], "VERSION.json rusak = dianggap belum terpasang");
  }));
