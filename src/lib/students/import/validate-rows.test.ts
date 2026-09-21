import { test } from "node:test";
import assert from "node:assert/strict";
import { matchHeaders } from "./headers";
import {
  buildClassLookup,
  collectLookupKeys,
  nonBlankRows,
  parseImportRows,
  validateImportRows,
  type ImportClass,
  type ImportLookups,
  type RawImportRow,
} from "./validate-rows";

const NOW = new Date("2026-09-21T03:00:00.000Z");
const HEADER = ["NISN", "NIS", "Nama Lengkap", "JK", "Tempat Lahir", "Tanggal Lahir", "Alamat", "Nama Wali", "No HP Wali", "Kelas", "SPP"];
const COLUMNS = matchHeaders(HEADER, true).columns;
const CLASSES: ImportClass[] = [
  { id: "c1", name: "VII A", schoolId: "s1", isActive: true, academicYearId: "ay1" },
  { id: "c2", name: "VII B", schoolId: "s1", isActive: false, academicYearId: "ay1" },
  { id: "c3", name: "VI A", schoolId: "s1", isActive: true, academicYearId: "ay0" },
];
const LOOKUP = buildClassLookup(CLASSES, "ay1");
const NO_LOOKUPS: ImportLookups = { existingNisns: new Set(), existingNisKeys: new Set(), holders: new Map() };
const ACTIVATION = { schoolId: "s1", schoolActive: true, timezone: "WIB" as const, activeAcademicYearId: "ay1", now: NOW };

let nextRow = 2;
function row(overrides: Partial<Record<number, unknown>> = {}): RawImportRow {
  const base: unknown[] = [
    `00${String(10_000_000 + nextRow)}`, `N${nextRow}`, "Budi Santoso", "L", "Bandung", "17/05/2012",
    "Jl. Merdeka No. 10, Bandung", "Siti Aminah", "081234567890", "vii  a", 150000,
  ];
  const values = base.map((value, i) => (i in overrides ? overrides[i] : value));
  const raw = { row: nextRow, values };
  nextRow += 1;
  return raw;
}

function validate(rows: RawImportRow[], activate = true, lookups: ImportLookups = NO_LOOKUPS) {
  const parsed = parseImportRows(rows, COLUMNS, LOOKUP);
  return validateImportRows(parsed, lookups, { activate, activation: ACTIVATION });
}

test("baris lengkap -> valid, kelas dicocokkan dengan nama ternormalisasi", () => {
  const raw = row();
  const { report, rows } = validate([raw]);
  assert.deepEqual(report.rows[0]?.errors, []);
  assert.equal(report.validRows, 1);
  assert.equal(rows[0]?.class?.id, "c1");
  assert.equal(rows[0]?.guardianPhone, "+6281234567890");
  assert.equal(rows[0]?.birthDate, "2012-05-17");
  assert.equal(rows[0]?.sppAmount, 150000);
});

test("kelas nonaktif / tahun ajaran lain / tak dikenal -> error", () => {
  const { report } = validate([row({ 9: "VII B" }), row({ 9: "VI A" }), row({ 9: "IX Z" })]);
  assert.equal(report.errorRows, 3);
  for (const r of report.rows) assert.match(r.errors.join(" "), /Kelas/);
});

test("nama kelas ganda di tahun yang sama -> error ambigu", () => {
  const lookup = buildClassLookup([...CLASSES, { id: "c9", name: "vii a", schoolId: "s1", isActive: true, academicYearId: "ay1" }], "ay1");
  const parsed = parseImportRows([row()], COLUMNS, lookup);
  assert.match(parsed[0]?.errors.join(" ") ?? "", /ganda/);
});

test("tanpa semester aktif, kelas aktif mana pun dapat dipilih", () => {
  const lookup = buildClassLookup(CLASSES, null);
  const parsed = parseImportRows([row({ 9: "VI A" })], COLUMNS, lookup);
  assert.equal(parsed[0]?.class?.id, "c3");
});

test("NISN ganda di berkas -> error pada SETIAP kemunculan", () => {
  const a = row({ 0: "0099999999" });
  const b = row();
  const c = row({ 0: "0099999999" });
  const { report } = validate([a, b, c]);
  assert.equal(report.errorRows, 2);
  assert.match(report.rows[0]?.errors.join(" ") ?? "", /NISN ganda/);
  assert.match(report.rows[2]?.errors.join(" ") ?? "", /NISN ganda/);
  assert.deepEqual(report.rows[1]?.errors, []);
});

test("NIS ganda di berkas (tanpa peka huruf) -> error pada setiap kemunculan", () => {
  const { report } = validate([row({ 1: "abc" }), row({ 1: "ABC" })]);
  assert.equal(report.errorRows, 2);
  assert.match(report.rows[0]?.errors.join(" ") ?? "", /NIS ganda/);
});

test("NISN / NIS sudah ada di sekolah -> error", () => {
  const a = row({ 0: "0011111111" });
  const b = row({ 1: "X-01" });
  const lookups: ImportLookups = { existingNisns: new Set(["0011111111"]), existingNisKeys: new Set(["X-01"]), holders: new Map() };
  const { report } = validate([a, b], true, lookups);
  assert.match(report.rows[0]?.errors.join(" ") ?? "", /NISN sudah terdaftar/);
  assert.match(report.rows[1]?.errors.join(" ") ?? "", /NIS sudah dipakai/);
});

test("pemegang NISN di sekolah lain: AKTIF/NONAKTIF error, LULUS peringatan (hanya saat aktivasi)", () => {
  const a = row({ 0: "0022222222" });
  const b = row({ 0: "0033333333" });
  const c = row({ 0: "0044444444" });
  const holders = new Map([
    ["0022222222", "ACTIVE" as const],
    ["0033333333", "INACTIVE" as const],
    ["0044444444", "GRADUATED" as const],
  ]);
  const lookups: ImportLookups = { existingNisns: new Set(), existingNisKeys: new Set(), holders };
  const { report } = validate([a, b, c], true, lookups);
  assert.match(report.rows[0]?.errors.join(" ") ?? "", /aktif di sekolah lain/);
  assert.match(report.rows[1]?.errors.join(" ") ?? "", /aktif di sekolah lain/);
  assert.deepEqual(report.rows[2]?.errors, []);
  assert.match(report.rows[2]?.warnings.join(" ") ?? "", /akun lama akan dilepas/);
  assert.equal(report.warningRows, 1);
  const draft = validate([row({ 0: "0022222222" })], false, lookups);
  assert.deepEqual(draft.report.rows[0]?.errors, []);
});

test("activate=true: kekurangan data aktivasi menjadi error; activate=false tidak", () => {
  const incomplete = { 4: null, 6: "Jl. A" };
  const active = validate([row(incomplete)], true);
  assert.equal(active.report.errorRows, 1);
  assert.match(active.report.rows[0]?.errors.join(" ") ?? "", /Tempat lahir wajib/);
  assert.match(active.report.rows[0]?.errors.join(" ") ?? "", /Alamat harus/);
  const draft = validate([row(incomplete)], false);
  assert.equal(draft.report.errorRows, 0);
});

test("umur di luar 5..25 -> error saat aktivasi", () => {
  const { report } = validate([row({ 5: "01/01/2024" })]);
  assert.match(report.rows[0]?.errors.join(" ") ?? "", /Umur siswa/);
});

test("field wajib kosong -> error walau activate=false; tanpa duplikasi pesan", () => {
  const { report } = validate([row({ 0: null, 2: null, 3: null })], true);
  const errors = report.rows[0]?.errors ?? [];
  assert.equal(errors.filter((e) => /NISN/.test(e)).length, 1);
  assert.equal(errors.filter((e) => /Nama lengkap/.test(e)).length, 1);
  assert.equal(errors.filter((e) => /Jenis kelamin/.test(e)).length, 1);
  const draft = validate([row({ 1: null })], false);
  assert.match(draft.report.rows[0]?.errors.join(" ") ?? "", /NIS wajib/);
});

test("format sel salah dilaporkan sekali (tanpa kekurangan aktivasi ganda)", () => {
  const { report } = validate([row({ 5: "31/02/2012", 8: "021555" })]);
  const errors = report.rows[0]?.errors ?? [];
  assert.equal(errors.filter((e) => /Tanggal lahir/.test(e)).length, 1);
  assert.equal(errors.filter((e) => /HP wali/.test(e)).length, 1);
});

test("NISN angka di-pad -> peringatan", () => {
  const { report } = validate([row({ 0: 12345678 })]);
  assert.equal(report.rows[0]?.nisn, "0012345678");
  assert.equal(report.warningRows, 1);
  assert.equal(report.validRows, 1);
});

test("nonBlankRows melewati baris kosong (termasuk yang hanya berisi kolom tak dikenal)", () => {
  const rows: RawImportRow[] = [
    { row: 2, values: [] },
    { row: 3, values: [null, "", "  "] },
    { row: 4, values: ["0012345678"] },
  ];
  assert.deepEqual(nonBlankRows(rows, COLUMNS).map((r) => r.row), [4]);
  const withNo = matchHeaders(["No", "NISN", "NIS", "Nama", "JK"], false).columns;
  assert.deepEqual(nonBlankRows([{ row: 2, values: [1, null, null, null, null] }], withNo), []);
});

test("collectLookupKeys mengumpulkan NISN & NIS unik yang valid", () => {
  const parsed = parseImportRows([row({ 0: "0055555555", 1: "a1" }), row({ 0: "0055555555", 1: "A1" }), row({ 0: "x" })], COLUMNS, LOOKUP);
  const keys = collectLookupKeys(parsed);
  assert.deepEqual(keys.nisns, ["0055555555", parsed[2]?.nisn].filter(Boolean));
  assert.deepEqual(keys.nis, ["a1", "A1", parsed[2]?.nis]);
});

test("ringkasan laporan: total, valid, error, peringatan", () => {
  const { report } = validate([row(), row({ 3: "X" }), row({ 0: 12345679 })]);
  assert.equal(report.totalRows, 3);
  assert.equal(report.validRows, 2);
  assert.equal(report.errorRows, 1);
  assert.equal(report.warningRows, 1);
  assert.deepEqual(report.rows.map((r) => r.row), [...report.rows.map((r) => r.row)].sort((a, b) => a - b));
});
