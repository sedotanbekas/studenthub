/**
 * Pembantu CLI bersama skrip deploy TypeScript (db-name, db-backup-cnf, storage-root).
 *
 * Skrip-skrip ini dipanggil dari bash di VPS dan stdout-nya dibaca shell sebagai NILAI, jadi:
 * - pesan error hanya ke stderr, dengan kode keluar 2 (beda dari crash tsx yang ber-exit 1);
 * - isi DATABASE_URL tidak pernah dicetak (baris error bisa mendarat di log GitHub Actions).
 */
import { config } from "dotenv";
import { parseDatabaseUrl, type DatabaseConnection } from "./db-url";

/**
 * Memuat `.env` di direktori kerja TANPA menimpa variabel yang sudah di-set — perilaku yang sama
 * dengan Next.js dan prisma.config.ts, sehingga penjaga membaca nilai yang benar-benar dipakai aplikasi.
 */
export function loadDotEnv(): void {
  // quiet: dotenv 17 mencetak baris info ke stdout, padahal stdout di sini dibaca shell.
  config({ quiet: true });
}

export function exitWithError(scriptName: string, message: string): never {
  console.error(`${scriptName}: ${message}`);
  process.exit(2);
}

/** Memuat .env lalu mengurai DATABASE_URL; keluar dengan kode 2 bila tidak ada atau tidak sah. */
export function loadDatabaseConnection(scriptName: string): DatabaseConnection {
  loadDotEnv();
  const raw = process.env.DATABASE_URL;
  if (!raw) exitWithError(scriptName, "DATABASE_URL tidak ditemukan di lingkungan maupun .env");
  try {
    return parseDatabaseUrl(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "sebab tidak dikenal";
    exitWithError(scriptName, `DATABASE_URL tidak dapat diurai: ${reason}`);
  }
}
