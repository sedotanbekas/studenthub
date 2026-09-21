/**
 * Mencetak NAMA DATABASE dari DATABASE_URL — satu-satunya keluaran stdout.
 *
 * Dipakai `scripts/deploy/remote-deploy.sh` sebagai penjaga: deploy berhenti bila `.env` di folder
 * staging/produksi menunjuk database lain (mis. .env salah salin yang akan memigrasi DB produksi
 * dari folder staging). `.env` dibaca dari direktori kerja lewat dotenv tanpa menimpa env yang ada.
 *
 *   pnpm exec tsx scripts/deploy/db-name.ts
 */
import { loadDatabaseConnection } from "./cli-env";

process.stdout.write(`${loadDatabaseConnection("db-name").database}\n`);
