import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { inclusiveDays } from "./ranges";
import { parseNationalHolidayFile, parseNationalImportArgs, planNationalHolidayImport, type NationalHolidayEntry } from "./national-import";

const DATA_FILE = path.join(process.cwd(), "prisma", "data", "national-holidays.json");

const entry = (name: string, startDate: string, endDate = startDate): NationalHolidayEntry => ({
  name, startDate, endDate, kind: "LIBUR_NASIONAL", source: "https://setneg.go.id/x",
});

test("berkas data resmi valid: tanggal nyata, unik nama+tanggal, jumlah hari sesuai SKB", () => {
  const entries = parseNationalHolidayFile(JSON.parse(readFileSync(DATA_FILE, "utf8")));
  const days = (year: string, kind: NationalHolidayEntry["kind"]) =>
    entries.filter((e) => e.kind === kind && e.startDate.startsWith(year)).reduce((sum, e) => sum + inclusiveDays(e), 0);
  assert.equal(days("2026", "LIBUR_NASIONAL"), 17);
  assert.equal(days("2026", "CUTI_BERSAMA"), 8);
  assert.equal(days("2027", "LIBUR_NASIONAL"), 18);
  assert.equal(days("2027", "CUTI_BERSAMA"), 8);
  for (const e of entries) assert.match(e.source, /^https:\/\/(www\.)?setneg\.go\.id\//);
});

test("parseNationalHolidayFile menolak duplikat, tanggal tidak nyata, dan rentang terbalik", () => {
  assert.throws(() => parseNationalHolidayFile([entry("A Libur", "2026-01-01"), entry("A Libur", "2026-01-01")]), /duplikat/i);
  assert.throws(() => parseNationalHolidayFile([entry("A Libur", "2026-02-30")]));
  assert.throws(() => parseNationalHolidayFile([entry("A Libur", "2026-01-05", "2026-01-01")]));
  assert.throws(() => parseNationalHolidayFile({ bukan: "array" }));
});

test("planNationalHolidayImport --force: buat baru, perbarui endDate, sisanya tidak berubah", () => {
  const entries = [entry("Tahun Baru", "2026-01-01"), entry("Idulfitri", "2026-03-21", "2026-03-22"), entry("Nyepi", "2026-03-19")];
  const existing = [
    { id: "h1", name: "Tahun Baru", startDate: "2026-01-01", endDate: "2026-01-01" },
    { id: "h2", name: "Idulfitri", startDate: "2026-03-21", endDate: "2026-03-21" },
    { id: "h3", name: "Lain", startDate: "2026-05-05", endDate: "2026-05-05" },
  ];
  const plan = planNationalHolidayImport(entries, existing, { force: true });
  assert.deepEqual(plan.create.map((e) => e.name), ["Nyepi"]);
  assert.deepEqual(plan.update.map((u) => [u.id, u.entry.endDate, u.beforeEndDate]), [["h2", "2026-03-22", "2026-03-21"]]);
  assert.equal(plan.unchanged, 1);
});

test("planNationalHolidayImport --force idempoten: impor kedua tidak mengubah apa pun", () => {
  const entries = [entry("Tahun Baru", "2026-01-01")];
  const plan = planNationalHolidayImport(entries, [{ id: "h1", name: "Tahun Baru", startDate: "2026-01-01", endDate: "2026-01-01" }], { force: true });
  assert.deepEqual([plan.create.length, plan.update.length, plan.unchanged], [0, 0, 1]);
});

test("planNationalHolidayImport tanpa --force: tahun yang sudah punya libur nasional dilewati seluruhnya", () => {
  const entries = [entry("Tahun Baru", "2026-01-01"), entry("Idulfitri", "2026-03-21", "2026-03-22"), entry("Tahun Baru", "2027-01-01")];
  const existing = [{ id: "h1", name: "Diganti Admin", startDate: "2026-03-21", endDate: "2026-03-21" }];
  const plan = planNationalHolidayImport(entries, existing);
  assert.deepEqual(plan.create.map((e) => e.startDate), ["2027-01-01"]);
  assert.deepEqual([plan.update.length, plan.unchanged], [0, 0], "baris tahun yang dilewati tidak diperbarui");
  assert.deepEqual(plan.skippedYears, [{ year: "2026", entries: 2 }]);
});

test("planNationalHolidayImport tanpa --force: tahun kosong dibuat semua, tidak ada tahun dilewati", () => {
  const plan = planNationalHolidayImport([entry("Tahun Baru", "2028-01-01"), entry("Natal", "2028-12-25")], []);
  assert.deepEqual([plan.create.length, plan.update.length, plan.unchanged, plan.skippedYears.length], [2, 0, 0, 0]);
});

test("parseNationalImportArgs: --force opsional, satu berkas opsional, flag lain ditolak", () => {
  assert.deepEqual(parseNationalImportArgs([]), { force: false, file: null });
  assert.deepEqual(parseNationalImportArgs(["data.json"]), { force: false, file: "data.json" });
  assert.deepEqual(parseNationalImportArgs(["--force", "data.json"]), { force: true, file: "data.json" });
  assert.deepEqual(parseNationalImportArgs(["data.json", "--force"]), { force: true, file: "data.json" });
  assert.throws(() => parseNationalImportArgs(["--dry-run"]), /--dry-run/);
  assert.throws(() => parseNationalImportArgs(["a.json", "b.json"]), /satu berkas/i);
});
