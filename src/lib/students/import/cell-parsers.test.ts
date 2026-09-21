import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cellText,
  normalizeClassName,
  parseDateCell,
  parseGenderCell,
  parseNameCell,
  parseNisCell,
  parseNisnCell,
  parsePhoneCell,
  parseSppCell,
  parseTextCell,
} from "./cell-parsers";

test("cellText: nilai exceljs (rich text, hyperlink, formula, error, Date, angka)", () => {
  assert.equal(cellText(null), null);
  assert.equal(cellText(undefined), null);
  assert.equal(cellText("  Budi   Santoso "), "Budi Santoso");
  assert.equal(cellText("   "), null);
  assert.equal(cellText(2026001), "2026001");
  assert.equal(cellText(true), "true");
  assert.equal(cellText({ richText: [{ text: "Budi " }, { text: "Santoso" }] }), "Budi Santoso");
  assert.equal(cellText({ text: "tautan", hyperlink: "https://x" }), "tautan");
  assert.equal(cellText({ formula: "A1", result: "hasil" }), "hasil");
  assert.equal(cellText({ error: "#N/A" }), null);
  assert.equal(cellText(new Date(Date.UTC(2012, 4, 17))), "2012-05-17");
});

test("NISN: string 10 digit diterima apa adanya", () => {
  assert.deepEqual(parseNisnCell("0012345678"), { value: "0012345678" });
  assert.deepEqual(parseNisnCell(" '0012345678"), { value: "0012345678" });
});

test("NISN: sel angka di-pad nol ke 10 digit dengan peringatan", () => {
  const padded = parseNisnCell(12345678);
  assert.equal(padded.value, "0012345678");
  assert.match(padded.warning ?? "", /nol/i);
  assert.deepEqual(parseNisnCell(1234567890), { value: "1234567890" });
});

test("NISN: notasi ilmiah diekspansi", () => {
  const sci = parseNisnCell("1.23456789E+9");
  assert.equal(sci.value, "1234567890");
  const sciPadded = parseNisnCell("1.2345678E+7");
  assert.equal(sciPadded.value, "0012345678");
  assert.ok(sciPadded.warning);
});

test("NISN: tidak valid -> error", () => {
  assert.ok(parseNisnCell("123456789").error);
  assert.ok(parseNisnCell("12345678901").error);
  assert.ok(parseNisnCell(12345678901).error);
  assert.ok(parseNisnCell(1234.5).error);
  assert.ok(parseNisnCell("0000000000").error);
  assert.ok(parseNisnCell("abcdefghij").error);
  assert.deepEqual(parseNisnCell(null), { value: null });
});

test("NIS: angka menjadi teks; pola divalidasi", () => {
  assert.deepEqual(parseNisCell(2026001), { value: "2026001" });
  assert.deepEqual(parseNisCell("2026/VII.01"), { value: "2026/VII.01" });
  assert.ok(parseNisCell("NIS 01").error);
  assert.deepEqual(parseNisCell(""), { value: null });
});

test("nama 3..100 karakter", () => {
  assert.deepEqual(parseNameCell("  Ani "), { value: "Ani" });
  assert.ok(parseNameCell("Al").error);
  assert.ok(parseNameCell("a".repeat(101)).error);
});

test("jenis kelamin: alias L/P/Laki-laki/Perempuan/M/F", () => {
  for (const raw of ["L", "l", "Laki-laki", "LAKI LAKI", "M", "male", "Pria"]) assert.equal(parseGenderCell(raw).value, "MALE", raw);
  for (const raw of ["P", "Perempuan", "f", "FEMALE", "Wanita"]) assert.equal(parseGenderCell(raw).value, "FEMALE", raw);
  assert.ok(parseGenderCell("X").error);
  assert.deepEqual(parseGenderCell(null), { value: null });
});

test("tanggal: sel Date, serial Excel, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD", () => {
  assert.equal(parseDateCell(new Date(Date.UTC(2012, 4, 17))).value, "2012-05-17");
  assert.equal(parseDateCell(41046).value, "2012-05-17");
  assert.equal(parseDateCell("17/05/2012").value, "2012-05-17");
  assert.equal(parseDateCell("7/5/2012").value, "2012-05-07");
  assert.equal(parseDateCell("17-05-2012").value, "2012-05-17");
  assert.equal(parseDateCell("2012-05-17").value, "2012-05-17");
});

test("tanggal tidak valid (31/02, format lain) -> error", () => {
  assert.ok(parseDateCell("31/02/2012").error);
  assert.ok(parseDateCell("2012/05/17").error);
  assert.ok(parseDateCell("17 Mei 2012").error);
  assert.ok(parseDateCell(-5).error);
  assert.ok(parseDateCell(new Date(Number.NaN)).error);
  assert.deepEqual(parseDateCell(null), { value: null });
});

test("HP wali: string & angka (nol depan hilang) dinormalisasi", () => {
  assert.equal(parsePhoneCell("0812-3456-7890").value, "+6281234567890");
  assert.equal(parsePhoneCell(81234567890).value, "+6281234567890");
  assert.equal(parsePhoneCell(6281234567890).value, "+6281234567890");
  assert.ok(parsePhoneCell("021555123").error);
  assert.deepEqual(parsePhoneCell(null), { value: null });
});

test("SPP: angka, teks berformat rupiah, batas 0..50.000.000", () => {
  assert.equal(parseSppCell(150000).value, 150000);
  assert.equal(parseSppCell("Rp 150.000").value, 150000);
  assert.equal(parseSppCell("150.000,00").value, 150000);
  assert.equal(parseSppCell(0).value, 0);
  assert.ok(parseSppCell(50_000_001).error);
  assert.ok(parseSppCell(1500.5).error);
  assert.ok(parseSppCell("seratus").error);
  assert.deepEqual(parseSppCell(""), { value: null });
});

test("teks bebas dibatasi panjangnya", () => {
  assert.deepEqual(parseTextCell(" Bandung ", 100, "Tempat lahir"), { value: "Bandung" });
  assert.ok(parseTextCell("a".repeat(101), 100, "Tempat lahir").error);
});

test("normalizeClassName: huruf besar & spasi dirapikan", () => {
  assert.equal(normalizeClassName("  vii   a "), "VII A");
  assert.equal(normalizeClassName("VII-A"), "VII-A");
});
