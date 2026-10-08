/**
 * Membersihkan database integration test SETELAH semua test lolos (dipanggil `pnpm test:int` lewat `&&`,
 * jadi tidak berjalan bila ada test gagal: data tetap ada untuk debugging).
 *
 * - Memuat .env.test (bila ada) TANPA menimpa variabel yang sudah di-set.
 * - MENOLAK (exit 1) bila nama database tidak berakhiran "_test".
 * - Lewati di CI (database dibuang bersama runner) atau bila TEST_DB_KEEP=1.
 * - Database test dihapus lalu dibuat ulang kosong; `prepare-db` menerapkan migrasi lagi pada test berikutnya.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { checkTestDatabaseUrl, cleanupStatements, shouldCleanupDatabase } from "./db-guard";

const ENV_FILE = resolve(process.cwd(), ".env.test");
const TAG = "[cleanup-db]";

function loadTestEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  const result = config({ path: ENV_FILE, override: false, quiet: true });
  if (result.error) throw new Error(`Gagal membaca .env.test: ${result.error.message}`);
}

async function main(): Promise<number> {
  loadTestEnv();
  if (!shouldCleanupDatabase({ CI: process.env.CI, TEST_DB_KEEP: process.env.TEST_DB_KEEP })) {
    console.log(`${TAG} Dilewati (CI atau TEST_DB_KEEP=1): data test tidak dihapus.`);
    return 0;
  }
  const guard = checkTestDatabaseUrl(process.env.DATABASE_URL);
  if (!guard.ok) {
    console.error(`${TAG} DITOLAK: ${guard.reason}`);
    return 1;
  }
  // Impor setelah .env.test dimuat: klien Prisma membaca DATABASE_URL saat dibuat.
  const { prisma } = await import("../../src/lib/db");
  try {
    for (const sql of cleanupStatements(guard.database)) await prisma.$executeRawUnsafe(sql);
  } finally {
    await prisma.$disconnect();
  }
  console.log(`${TAG} Semua test lolos: data test di "${guard.database}" (${guard.host}) sudah dihapus.`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error: unknown) => {
    console.error(`${TAG} ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
