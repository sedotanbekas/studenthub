import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { checkZipArchive, isZipMagic } from "./zip-guard";

interface Entry {
  readonly name: string;
  readonly data: Buffer;
  readonly method?: 0 | 8;
  /** Ukuran tak-terkompresi yang DIKLAIM header (bisa bohong). */
  readonly declaredSize?: number;
}

/** Bangun ZIP minimal (local header + central directory + EOCD) untuk test. */
function buildZip(entries: readonly Entry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const method = entry.method ?? 8;
    const payload = method === 8 ? deflateRawSync(entry.data) : entry.data;
    const name = Buffer.from(entry.name, "utf8");
    const size = entry.declaredSize ?? entry.data.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, payload);
    centrals.push(central, name);
    offset += local.length + name.length + payload.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const MIB = 1024 * 1024;

test("isZipMagic mengenali tanda PK\\x03\\x04", () => {
  assert.equal(isZipMagic(buildZip([{ name: "a.txt", data: Buffer.from("halo") }])), true);
  assert.equal(isZipMagic(Buffer.from("nisn,nis\n")), false);
  assert.equal(isZipMagic(Buffer.alloc(2)), false);
});

test("arsip normal lolos dan byte tak-terkompresi dihitung", () => {
  const zip = buildZip([
    { name: "xl/a.xml", data: Buffer.alloc(1000, 65) },
    { name: "xl/b.xml", data: Buffer.from("stored"), method: 0 },
  ]);
  assert.deepEqual(checkZipArchive(zip, 25 * MIB), { ok: true, entries: 2, totalUncompressed: 1006 });
});

test("entri yang mengembang melebihi batas ditolak walau header berbohong", () => {
  // 26 MiB nol terkompresi jadi ~26 KiB; header mengklaim hanya 100 byte.
  const bomb = buildZip([{ name: "xl/bom.xml", data: Buffer.alloc(26 * MIB), declaredSize: 100 }]);
  assert.ok(bomb.length < 100 * 1024);
  const result = checkZipArchive(bomb, 25 * MIB);
  assert.deepEqual(result, { ok: false, reason: "ukuran setelah dekompresi melebihi batas" });
});

test("total beberapa entri melebihi batas ditolak", () => {
  const zip = buildZip([
    { name: "a", data: Buffer.alloc(600 * 1024) },
    { name: "b", data: Buffer.alloc(600 * 1024) },
  ]);
  assert.equal(checkZipArchive(zip, 1 * MIB).ok, false);
  assert.equal(checkZipArchive(zip, 2 * MIB).ok, true);
});

test("klaim ukuran di central directory melebihi batas ditolak cepat", () => {
  const zip = buildZip([{ name: "a", data: Buffer.from("kecil"), declaredSize: 30 * MIB }]);
  assert.equal(checkZipArchive(zip, 25 * MIB).ok, false);
});

test("arsip rusak / terpotong / metode tak dikenal ditolak", () => {
  const zip = buildZip([{ name: "a", data: Buffer.alloc(1000, 66) }]);
  assert.equal(checkZipArchive(zip.subarray(0, zip.length - 10), 25 * MIB).ok, false);
  assert.equal(checkZipArchive(Buffer.from("PK\x03\x04bukan zip"), 25 * MIB).ok, false);
  const corrupt = Buffer.from(zip);
  const centralStart = corrupt.length - 22 - (46 + 1); // EOCD 22 byte, central header 46 + nama 1 byte
  corrupt.writeUInt16LE(12, centralStart + 10); // metode kompresi -> 12 (bzip2, tidak didukung)
  assert.equal(checkZipArchive(corrupt, 25 * MIB).ok, false);
});

test("jumlah entri dibatasi", () => {
  const zip = buildZip(Array.from({ length: 5 }, (_, i) => ({ name: `f${i}`, data: Buffer.from("x") })));
  assert.equal(checkZipArchive(zip, 25 * MIB, 4).ok, false);
  assert.equal(checkZipArchive(zip, 25 * MIB, 5).ok, true);
});
