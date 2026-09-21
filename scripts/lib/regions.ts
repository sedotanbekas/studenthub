/**
 * Parser data wilayah Kemendagri (format dump `cahyadsn/wilayah`, lisensi MIT) menjadi
 * provinsi (kode "32") dan kabupaten/kota (kode "32.73"), plus pembangkit SQL migrasi idempoten.
 */

export type Province = { code: string; name: string };
export type City = { code: string; provinceCode: string; name: string };
export type RegionData = { provinces: Province[]; cities: City[] };

const ROW_PATTERN = /\('(\d{2}(?:\.\d{2})?)','((?:[^']|'')*)'\)/g;

export function parseWilayahDump(sql: string): RegionData {
  const provinces: Province[] = [];
  const cities: City[] = [];
  for (const match of sql.matchAll(ROW_PATTERN)) {
    const code = match[1] as string;
    const name = (match[2] as string).replace(/''/g, "'").trim();
    if (code.length === 2) provinces.push({ code, name });
    else cities.push({ code, provinceCode: code.slice(0, 2), name });
  }
  return {
    provinces: [...provinces].sort((a, b) => a.code.localeCompare(b.code)),
    cities: [...cities].sort((a, b) => a.code.localeCompare(b.code)),
  };
}

/** Validasi invarian dataset; mengembalikan daftar masalah (kosong = valid). */
export function validateRegionData(data: RegionData): string[] {
  const problems: string[] = [];
  const provinceCodes = new Set(data.provinces.map((p) => p.code));
  if (provinceCodes.size !== data.provinces.length) problems.push("Kode provinsi ganda");
  const cityCodes = new Set(data.cities.map((c) => c.code));
  if (cityCodes.size !== data.cities.length) problems.push("Kode kabupaten/kota ganda");
  for (const city of data.cities) {
    if (!provinceCodes.has(city.provinceCode)) problems.push(`Provinsi ${city.provinceCode} untuk ${city.code} tidak ada`);
    if (!/^\d{2}\.\d{2}$/.test(city.code)) problems.push(`Format kode kota salah: ${city.code}`);
  }
  for (const p of data.provinces) {
    if (!/^\d{2}$/.test(p.code)) problems.push(`Format kode provinsi salah: ${p.code}`);
    if (p.name.length === 0 || p.name.length > 100) problems.push(`Nama provinsi ${p.code} tidak valid`);
  }
  return problems;
}

const sqlString = (value: string): string => `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;

/** SQL idempoten: INSERT ... ON DUPLICATE KEY UPDATE name (aman dijalankan ulang). */
export function buildRegionsMigrationSql(data: RegionData, sourceNote: string): string {
  const provinceRows = data.provinces.map((p) => `  (${sqlString(p.code)}, ${sqlString(p.name)})`);
  const cityRows = data.cities.map((c) => `  (${sqlString(c.code)}, ${sqlString(c.provinceCode)}, ${sqlString(c.name)})`);
  return [
    `-- Data wilayah: ${sourceNote}`,
    `-- ${data.provinces.length} provinsi, ${data.cities.length} kabupaten/kota. Dibangkitkan oleh scripts/gen-regions-migration.ts.`,
    "INSERT INTO `Province` (`code`, `name`) VALUES",
    `${provinceRows.join(",\n")}`,
    "ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);",
    "",
    "INSERT INTO `City` (`code`, `provinceCode`, `name`) VALUES",
    `${cityRows.join(",\n")}`,
    "ON DUPLICATE KEY UPDATE `provinceCode` = VALUES(`provinceCode`), `name` = VALUES(`name`);",
    "",
  ].join("\n");
}
