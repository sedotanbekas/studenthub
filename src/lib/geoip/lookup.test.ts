import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { GEOIP_FILES } from "./files";
import { createGeoLookup, type GeoReader } from "./lookup";

/** Pembaca palsu: kota = "kota#<urutan buka>", ASN tetap. */
function fakeOpener() {
  const opened: string[] = [];
  const open = async (file: string): Promise<GeoReader> => {
    opened.push(path.basename(file));
    const generation = opened.length;
    return file.endsWith(GEOIP_FILES.city)
      ? { get: () => ({ city: { names: { en: `kota#${generation}` } }, country: { iso_code: "ID" } }) }
      : { get: () => ({ autonomous_system_number: 7713, autonomous_system_organization: "Telkom" }) };
  };
  return { opened, open };
}

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "geoip-lookup-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const install = (dir: string) => Promise.all(Object.values(GEOIP_FILES).map((name) => writeFile(path.join(dir, name), "mmdb")));

test("createGeoLookup: berkas belum diunduh -> null tanpa membuka; IP kosong -> null", () =>
  withDir(async (dir) => {
    const { opened, open } = fakeOpener();
    const geo = createGeoLookup(() => dir, open);
    assert.equal(await geo.lookup("36.68.10.1"), null);
    assert.equal(await geo.lookup(null), null);
    assert.deepEqual(opened, []);
    geo.release();
  }));

test("createGeoLookup: berkas muncul setelah deploy -> langsung terbaca (null tidak ikut di-cache)", () =>
  withDir(async (dir) => {
    const { opened, open } = fakeOpener();
    const geo = createGeoLookup(() => dir, open);
    assert.equal(await geo.lookup("36.68.10.1"), null);
    await install(dir);
    const info = await geo.lookup("36.68.10.1");
    assert.equal(info?.isp, "Telkom");
    assert.equal(opened.length, 2);
    geo.release();
  }));

test("createGeoLookup: berkas sama -> pembaca dipakai ulang; berkas diganti (rilis bulan baru) -> dimuat ulang", () =>
  withDir(async (dir) => {
    await install(dir);
    const { opened, open } = fakeOpener();
    const geo = createGeoLookup(() => dir, open);
    const first = await geo.lookup("36.68.10.1");
    await geo.lookup("114.124.200.10");
    assert.equal(opened.length, 2, "tanpa perubahan berkas tidak dibuka ulang");
    const later = new Date(Date.now() + 60_000);
    await utimes(path.join(dir, GEOIP_FILES.city), later, later);
    const second = await geo.lookup("36.68.10.1");
    assert.equal(opened.length, 4);
    assert.notEqual(first?.city, second?.city);
    geo.release();
  }));

test("createGeoLookup: pembaca gagal dibuka -> null (login tidak pernah gagal karena lokasi)", () =>
  withDir(async (dir) => {
    await install(dir);
    const geo = createGeoLookup(() => dir, async () => {
      throw new Error("berkas rusak");
    });
    assert.equal(await geo.lookup("36.68.10.1"), null);
    geo.release();
  }));
