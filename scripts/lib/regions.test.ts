import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegionsMigrationSql, parseWilayahDump, validateRegionData } from "./regions";

const SAMPLE = `
INSERT INTO wilayah (kode,nama) VALUES
('11','Aceh'),
('11.01','Kabupaten Aceh Selatan'),
('11.01.01','Bakongan'),
('11.01.01.2001','Keude Bakongan'),
('92','Papua Barat Daya'),
('92.71','Kota Sorong'),
('31.01','Kabupaten Kepulauan O''Seribu');
`;

test("parseWilayahDump hanya mengambil provinsi dan kabupaten/kota", () => {
  const data = parseWilayahDump(SAMPLE);
  assert.deepEqual(data.provinces.map((p) => p.code), ["11", "92"]);
  assert.deepEqual(data.cities.map((c) => c.code), ["11.01", "31.01", "92.71"]);
  assert.equal(data.cities.find((c) => c.code === "92.71")?.provinceCode, "92");
});

test("parseWilayahDump membuka escape tanda kutip", () => {
  const data = parseWilayahDump(SAMPLE);
  assert.equal(data.cities.find((c) => c.code === "31.01")?.name, "Kabupaten Kepulauan O'Seribu");
});

test("validateRegionData melaporkan kota tanpa provinsi", () => {
  const problems = validateRegionData(parseWilayahDump(SAMPLE));
  assert.deepEqual(problems, ["Provinsi 31 untuk 31.01 tidak ada"]);
});

test("validateRegionData lolos untuk data konsisten", () => {
  const data = { provinces: [{ code: "11", name: "Aceh" }], cities: [{ code: "11.01", provinceCode: "11", name: "Kab" }] };
  assert.deepEqual(validateRegionData(data), []);
});

test("buildRegionsMigrationSql idempoten dan meng-escape kutip", () => {
  const sql = buildRegionsMigrationSql(
    { provinces: [{ code: "11", name: "Aceh" }], cities: [{ code: "11.01", provinceCode: "11", name: "O'Seribu" }] },
    "uji",
  );
  assert.match(sql, /ON DUPLICATE KEY UPDATE `name` = VALUES\(`name`\);/);
  assert.match(sql, /'O''Seribu'/);
});
