/**
 * Impor libur nasional + cuti bersama (SKB 3 Menteri) sebagai Holiday ber-schoolId NULL.
 *
 *   pnpm holidays:import [--force] [path/ke/berkas.json]
 *
 * Default berkas: prisma/data/national-holidays.json. Data dapat diedit super admin lewat
 * /api/v1/platform/holidays setelah diimpor (karena itu bukan migrasi).
 *
 * Default (aman dijalankan ulang): diproses per TAHUN (tahun tanggal mulai). Tahun yang sudah punya
 * minimal satu libur nasional DILEWATI seluruhnya ("tahun sudah diimpor, dilewati"), sehingga libur yang
 * sudah diganti nama/dihapus super admin tidak dibuat ulang. Tahun yang belum punya libur nasional
 * (mis. SKB tahun depan yang baru ditambahkan ke berkas) dibuat seluruhnya.
 * Catatan: bila super admin sudah menambah libur nasional manual pada tahun yang belum pernah diimpor,
 * tahun itu ikut dilewati -> lengkapi lewat API, atau jalankan dengan --force.
 *
 * --force: perilaku lama, cocok per nama + tanggal mulai di semua tahun. Entri tanpa pasangan DIBUAT
 * (termasuk libur yang pernah dihapus/diganti nama super admin), pasangan dengan endDate berbeda
 * diperbarui endDate-nya. Periksa hasil edit super admin sebelum memakainya.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ActionContext } from "../src/lib/auth/principal";
import { prisma } from "../src/lib/db";
import { parseNationalHolidayFile, parseNationalImportArgs, YEAR_ALREADY_IMPORTED_NOTE } from "../src/lib/calendar/national-import";
import { importNationalHolidays } from "../src/lib/calendar/national-import-service";

const DEFAULT_FILE = path.join(process.cwd(), "prisma", "data", "national-holidays.json");

function cliContext(): ActionContext {
  return {
    principal: null,
    now: new Date(),
    requestId: `cli-${randomUUID()}`,
    ip: null,
    userAgent: "scripts/import-national-holidays",
    defer: () => undefined,
  };
}

async function main(): Promise<void> {
  const args = parseNationalImportArgs(process.argv.slice(2));
  const file = args.file ? path.resolve(args.file) : DEFAULT_FILE;
  const entries = parseNationalHolidayFile(JSON.parse(readFileSync(file, "utf8")));
  const result = await importNationalHolidays(entries, cliContext(), { force: args.force });
  for (const skipped of result.skippedYears) {
    console.log(`${skipped.year}: ${YEAR_ALREADY_IMPORTED_NOTE} (${skipped.entries} entri; --force untuk mencocokkan per nama + tanggal mulai)`);
  }
  console.log(JSON.stringify({ file: path.relative(process.cwd(), file), entries: entries.length, force: args.force, ...result }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(`import-national-holidays: ${error instanceof Error ? error.message : "gagal"}`);
    await prisma.$disconnect();
    process.exit(1);
  });
