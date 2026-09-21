/**
 * Mencetak path absolut STORAGE_ROOT (dari env atau `.env` direktori kerja) — satu-satunya keluaran
 * stdout. Dipakai `scripts/deploy/backup-storage.sh` agar lokasi yang diarsipkan sama persis dengan
 * yang dipakai aplikasi (path relatif di-resolve terhadap direktori kerja, seperti proses PM2).
 *
 *   pnpm exec tsx scripts/deploy/storage-root.ts
 */
import { resolve } from "node:path";
import { exitWithError, loadDotEnv } from "./cli-env";

loadDotEnv();
const raw = process.env.STORAGE_ROOT?.trim();
if (!raw) exitWithError("storage-root", "STORAGE_ROOT tidak ditemukan di lingkungan maupun .env");

process.stdout.write(`${resolve(raw)}\n`);
