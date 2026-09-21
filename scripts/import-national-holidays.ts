/**
 * Impor libur nasional + cuti bersama (SKB 3 Menteri) sebagai Holiday ber-schoolId NULL.
 * Idempoten: cocok berdasarkan nama + tanggal mulai; dijalankan ulang tidak menggandakan baris.
 *
 *   pnpm tsx scripts/import-national-holidays.ts [path/ke/berkas.json]
 *
 * Default berkas: prisma/data/national-holidays.json. Data dapat diedit super admin lewat
 * /api/v1/platform/holidays setelah diimpor (karena itu bukan migrasi).
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ActionContext } from "../src/lib/auth/principal";
import { prisma } from "../src/lib/db";
import { parseNationalHolidayFile } from "../src/lib/calendar/national-import";
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
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
  const entries = parseNationalHolidayFile(JSON.parse(readFileSync(file, "utf8")));
  const result = await importNationalHolidays(entries, cliContext());
  console.log(JSON.stringify({ file: path.relative(process.cwd(), file), entries: entries.length, ...result }));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(`import-national-holidays: ${error instanceof Error ? error.message : "gagal"}`);
    await prisma.$disconnect();
    process.exit(1);
  });
