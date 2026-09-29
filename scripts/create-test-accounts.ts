/**
 * Akun uji untuk blackbox testing di produksi & staging sebelum peluncuran: `pnpm db:akun-uji`
 * (di VPS dijalankan workflow manual .github/workflows/akun-uji.yml lewat scripts/deploy/akun-uji.sh).
 *
 * - Berbeda dengan seed demo, BOLEH di database produksi: hanya menyentuh sekolah/akun uji
 *   (@uji.studenthub.id, NPSN 99990100, NISN 99100000xx — scripts/lib/test-accounts-plan.ts).
 * - Kata sandi SEMUA akun uji dari env TEST_ACCOUNT_PASSWORD, tidak pernah dari kode, tidak pernah dicetak.
 * - Idempoten: dijalankan ulang = reset kata sandi akun uji & aktifkan lagi.
 * - Super admin uji wajib mendaftar TOTP sekali saat masuk pertama (aplikasi autentikator); kolom TOTP tidak
 *   disentuh seed sehingga pendaftaran bertahan. Hilang HP: `pnpm db:totp-reset --email superadmin@uji.studenthub.id`.
 */
import "dotenv/config";
import { BCRYPT_COST, hashPassword } from "../src/lib/auth/password";
import { parseDatabaseUrl } from "./deploy/db-url";
import { checkTestAccountPassword, testAccountLogins } from "./lib/test-accounts-plan";

const TAG = "[akun-uji]";

async function main(): Promise<number> {
  let target: string;
  try {
    const conn = parseDatabaseUrl((process.env.DATABASE_URL ?? "").trim());
    target = `"${conn.database}" di ${conn.host}:${conn.port}`;
  } catch (error) {
    console.error(`${TAG} DITOLAK: ${error instanceof Error ? error.message : "DATABASE_URL tidak valid."}`);
    return 1;
  }
  const password = process.env.TEST_ACCOUNT_PASSWORD;
  const problems = checkTestAccountPassword(password);
  if (problems.length > 0) {
    console.error(`${TAG} DITOLAK: ${problems.join(" ")}`);
    return 1;
  }
  console.log(`${TAG} Database: ${target}.`);
  const passwordHash = await hashPassword(password ?? "", BCRYPT_COST);
  // Impor dinamis: klien Prisma baru dibuat setelah pemeriksaan lolos.
  const { runTestAccountsSeed } = await import("./lib/test-accounts");
  const { prisma } = await import("../src/lib/db");
  try {
    const summary = await runTestAccountsSeed({ passwordHash });
    console.log(`${TAG} Sekolah uji: ${summary.school.name} (NPSN ${summary.school.npsn}), ${summary.school.activeStudents} siswa aktif.`);
  } finally {
    await prisma.$disconnect();
  }
  console.table(testAccountLogins().map((l) => ({ Peran: l.role, Nama: l.name, "Masuk dengan": l.login })));
  console.log(`${TAG} Semua akun memakai kata sandi TEST_ACCOUNT_PASSWORD. Super admin: daftar TOTP saat masuk pertama.`);
  return 0;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`${TAG} Gagal: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
