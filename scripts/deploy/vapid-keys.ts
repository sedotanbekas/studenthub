/**
 * Kunci VAPID Web Push (N3) untuk `.env` deploy (remote-deploy.sh ensure_vapid_keys). Membaca env / `.env` direktori
 * kerja (dotenv, tanpa menimpa). Keluar 0 = sudah ada (tanpa keluaran); 3 = dua baris `KEY=value` baru di stdout
 * (shell menambahkannya ke .env; nilai tidak pernah dilog); 2 = tidak lengkap / tidak sah (pesan di stderr).
 *
 *   pnpm exec tsx scripts/deploy/vapid-keys.ts
 */
import { exitWithError, loadDotEnv } from "./cli-env";
import { vapidKeysAction } from "./vapid-keys-rules";

loadDotEnv();
const action = vapidKeysAction({ VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY });
if (action.code === 2) exitWithError("vapid-keys", `${action.message} — perbaiki manual (jangan dibuat ulang: semua langganan push putus)`);
if (action.code === 3) {
  process.stdout.write(`${action.lines}\n`);
  process.exit(3);
}
