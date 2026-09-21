import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeCsvBytes, detectDelimiter, parseCsv } from "./csv";

const bytes = (text: string) => new TextEncoder().encode(text);

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
  const rows = parseCsv(`nisn,nama,alamat\r\n0012345678,"Budi, S.","Jl. ""Mawar""\nBandung"\r\n`);
  assert.deepEqual(rows, [
    ["nisn", "nama", "alamat"],
    ["0012345678", "Budi, S.", `Jl. "Mawar"\nBandung`],
  ]);
});

test("parseCsv: pemisah titik koma dan baris tanpa newline akhir", () => {
  assert.deepEqual(parseCsv("a;b\n1;2"), [["a", "b"], ["1", "2"]]);
});

test("parseCsv: baris kosong dipertahankan sebagai baris kosong (nomor baris tetap akurat)", () => {
  assert.deepEqual(parseCsv("a,b\n\n1,2\n"), [["a", "b"], [""], ["1", "2"]]);
});
