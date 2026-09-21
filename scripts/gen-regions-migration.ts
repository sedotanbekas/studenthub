/**
 * Membangkitkan migrasi data wilayah dari dump `cahyadsn/wilayah` (MIT).
 * Pemakaian: pnpm regions:gen <path/ke/wilayah.sql>
 * Hasil: prisma/data/regions.json (di-commit) dan migrasi 20260921000100_regions.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRegionsMigrationSql, parseWilayahDump, validateRegionData } from "./lib/regions";

const SOURCE_NOTE = "cahyadsn/wilayah (MIT) - Kepmendagri No 300.2.2-2138 Tahun 2025";
const MIGRATION_DIR = "prisma/migrations/20260921000100_regions";

function main(): void {
  const input = process.argv[2];
  if (!input) throw new Error("Pemakaian: pnpm regions:gen <path/ke/wilayah.sql>");
  const data = parseWilayahDump(readFileSync(input, "utf8"));
  const problems = validateRegionData(data);
  if (problems.length > 0) throw new Error(`Data wilayah tidak valid:\n${problems.join("\n")}`);
  writeFileSync("prisma/data/regions.json", `${JSON.stringify({ source: SOURCE_NOTE, ...data }, null, 1)}\n`);
  mkdirSync(MIGRATION_DIR, { recursive: true });
  writeFileSync(path.join(MIGRATION_DIR, "migration.sql"), buildRegionsMigrationSql(data, SOURCE_NOTE));
  console.log(`OK: ${data.provinces.length} provinsi, ${data.cities.length} kabupaten/kota`);
}

main();
