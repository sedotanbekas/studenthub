/**
 * Menyiapkan database integration test sebelum `node --test` berjalan (dipanggil `pnpm test:int`).
 *
 * - Memuat .env.test (bila ada) TANPA menimpa variabel yang sudah di-set (CI men-set DATABASE_URL sendiri).
 * - MENOLAK (exit 1) bila nama database tidak berakhiran "_test": reset menghapus seluruh data.
 * - Lokal: `prisma migrate reset --force` (drop + buat ulang + migrasi; Prisma 7 tidak seed saat reset).
 * - CI (variabel CI terisi): `prisma migrate deploy` saja, karena database CI selalu baru.
 * - TEST_DB_NO_RESET=1: `prisma migrate deploy` saja (tanpa menghapus data). Catatan: Prisma 7
 *   menolak `migrate reset` yang dijalankan agen AI tanpa persetujuan eksplisit pengguna; agen
 *   memakai `TEST_DB_NO_RESET=1 pnpm test:int`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { checkTestDatabaseUrl, commandLine, isFlagSet, migrateCommand, shouldResetDatabase } from "./db-guard";

const ENV_FILE = resolve(process.cwd(), ".env.test");
const TAG = "[prepare-db]";

function loadTestEnv(): void {
  if (!existsSync(ENV_FILE)) return;
  const result = config({ path: ENV_FILE, override: false, quiet: true });
  if (result.error) throw new Error(`Gagal membaca .env.test: ${result.error.message}`);
}

function runMigration(databaseUrl: string, reset: boolean): number {
  const command = migrateCommand(reset);
  const line = commandLine(command);
  console.log(`${TAG} ${command.label} ...`);
  // shell: true => cmd.exe di Windows (npx adalah npx.cmd), /bin/sh di Linux. Perintah statis.
  const result = spawnSync(line, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.error) {
    console.error(`${TAG} Gagal menjalankan "${line}": ${result.error.message}`);
    return 1;
  }
  if (result.status !== 0) {
    const reason = result.signal ? `sinyal ${result.signal}` : `kode keluar ${String(result.status)}`;
    console.error(`${TAG} "${line}" gagal (${reason}).`);
    return result.status && result.status > 0 ? result.status : 1;
  }
  return 0;
}

function main(): number {
  loadTestEnv();
  const databaseUrl = process.env.DATABASE_URL;
  const guard = checkTestDatabaseUrl(databaseUrl);
  if (!guard.ok || databaseUrl === undefined) {
    console.error(`${TAG} DITOLAK: ${guard.ok ? "DATABASE_URL belum diisi." : guard.reason}`);
    console.error(`${TAG} Integration test hanya boleh berjalan pada database yang namanya berakhiran "_test".`);
    return 1;
  }
  const reset = shouldResetDatabase({ CI: process.env.CI, TEST_DB_NO_RESET: process.env.TEST_DB_NO_RESET });
  const mode = isFlagSet(process.env.CI) ? " (mode CI)" : reset ? "" : " (TEST_DB_NO_RESET)";
  console.log(`${TAG} Database test: "${guard.database}" di ${guard.host}${mode}.`);
  const code = runMigration(databaseUrl, reset);
  if (code === 0) console.log(`${TAG} Database test siap.`);
  return code;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(`${TAG} ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
