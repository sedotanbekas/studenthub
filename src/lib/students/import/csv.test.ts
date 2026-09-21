import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCsvBytes, detectDelimiter, parseCsv } from "./csv";

const bytes = (text: string) => new TextEncoder().encode(text);
const LIMITS = { maxColumns: 64, maxRows: 1000 };

test("decodeCsvBytes: BOM UTF-8 dibuang", () => {
  assert.equal(decodeCsvBytes(bytes("﻿nisn,nama")), "nisn,nama");
});

test("decodeCsvBytes: bukan UTF-8 -> fallback windows-1252", () => {
  assert.equal(decodeCsvBytes(new Uint8Array([0x4a, 0xe9, 0x72, 0xf4, 0x6d, 0x65])), "Jérôme");
});

test("decodeCsvBytes: byte NUL = berkas biner -> null", () => {
  assert.equal(decodeCsvBytes(new Uint8Array([0x6e, 0x00, 0x69])), null);
});

test("detectDelimiter: koma atau titik koma (di luar kutip)", () => {
  assert.equal(detectDelimiter("nisn,nis,nama"), ",");
  assert.equal(detectDelimiter("nisn;nis;nama"), ";");
  assert.equal(detectDelimiter(`"a,b,c";nis;nama`), ";");
  assert.equal(detectDelimiter("nisn"), ",");
});

test("parseCsv: kutip, kutip ganda, baris baru dalam kutip, CRLF", () => {
  const result = parseCsv(`nisn,nama,alamat\r\n0012345678,"Budi, S.","Jl. ""Mawar""\nBandung"\r\n`, LIMITS);
  assert.equal(result.overflow, false);
  assert.deepEqual(result.records, [
    { row: 1, values: ["nisn", "nama", "alamat"] },
    { row: 2, values: ["0012345678", "Budi, S.", `Jl. "Mawar"\nBandung`] },
  ]);
});

test("parseCsv: pemisah titik koma dan baris tanpa newline akhir", () => {
  assert.deepEqual(parseCsv("a;b\n1;2", LIMITS).records, [
    { row: 1, values: ["a", "b"] },
    { row: 2, values: ["1", "2"] },
  ]);
});

test("parseCsv: baris kosong/spasi dilewati, nomor baris tetap akurat", () => {
  assert.deepEqual(parseCsv("a,b\n\n  , \n1,2\n", LIMITS).records, [
    { row: 1, values: ["a", "b"] },
    { row: 4, values: ["1", "2"] },
  ]);
});

test("parseCsv: berhenti segera setelah baris berisi melewati batas (overflow)", () => {
  const text = Array.from({ length: 50_000 }, (_, i) => `r${i},x`).join("\n");
  const result = parseCsv(text, { maxColumns: 64, maxRows: 10 });
  assert.equal(result.overflow, true);
  assert.equal(result.records.length, 11);
  assert.deepEqual(parseCsv("a\nb\n\n", { maxColumns: 64, maxRows: 2 }).overflow, false);
});

test("parseCsv: jumlah kolom per baris dibatasi (kolom berlebih dibuang)", () => {
  const wide = Array.from({ length: 5000 }, (_, i) => `c${i}`).join(",");
  const { records } = parseCsv(`${wide}\n1,2,3,4,5`, { maxColumns: 3, maxRows: 10 });
  assert.deepEqual(records[0]?.values, ["c0", "c1", "c2"]);
  assert.deepEqual(records[1]?.values, ["1", "2", "3"]);
});

test("parseCsv: baris yang isinya hanya di kolom terbuang dianggap kosong", () => {
  const { records } = parseCsv("a,b\n,,z\n1,2", { maxColumns: 2, maxRows: 10 });
  assert.deepEqual(records.map((r) => r.row), [1, 3]);
});
