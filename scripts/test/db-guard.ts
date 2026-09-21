/**
 * Aturan murni pengaman database test (dipakai scripts/test/prepare-db.ts).
 * Integration test MENGHAPUS seluruh isi database, jadi hanya database yang namanya berakhiran
 * "_test" yang boleh disentuh. Tidak ada I/O di sini agar bisa diuji unit.
 */

export type DbGuardResult =
  | { readonly ok: true; readonly database: string; readonly host: string }
  | { readonly ok: false; readonly reason: string };

export type MigrateCommand = {
  readonly args: readonly string[];
  /** Deskripsi singkat untuk log (Bahasa Indonesia). */
  readonly label: string;
};

/** Nama database MariaDB yang aman: huruf, angka, _, $ dan WAJIB berakhiran "_test". */
const TEST_DB_NAME = /^[A-Za-z0-9_$]+_test$/;

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function decodeName(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname.replace(/^\//, ""));
  } catch {
    return null;
  }
}

/**
 * Validasi DATABASE_URL untuk integration test. Pesan penolakan hanya memuat host dan nama
 * database, tidak pernah user/password.
 */
export function checkTestDatabaseUrl(raw: string | undefined): DbGuardResult {
  const value = raw?.trim() ?? "";
  if (value === "") return { ok: false, reason: "DATABASE_URL belum diisi (isi di .env.test atau environment)." };
  const url = parseUrl(value);
  if (!url) return { ok: false, reason: "DATABASE_URL bukan URL yang valid." };
  if (url.protocol !== "mysql:") {
    return { ok: false, reason: `DATABASE_URL harus berskema mysql:// (didapat ${url.protocol}//).` };
  }
  const database = decodeName(url.pathname);
  if (!database) return { ok: false, reason: `DATABASE_URL (${url.host}) tidak memuat nama database.` };
  if (!TEST_DB_NAME.test(database)) {
    return {
      ok: false,
      reason: `database "${database}" di ${url.host} bukan database test: nama wajib berakhiran "_test" dan hanya berisi huruf, angka, _ atau $.`,
    };
  }
  return { ok: true, database, host: url.host };
}

/** Variabel lingkungan yang memengaruhi cara database test disiapkan. */
export type PrepareDbFlags = { readonly CI?: string; readonly TEST_DB_NO_RESET?: string };

/** true bila flag terisi dan bukan "false"/"0" (mis. CI=true, TEST_DB_NO_RESET=1). */
export function isFlagSet(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized !== "" && normalized !== "false" && normalized !== "0";
}

/**
 * Reset penuh hanya untuk lokal. Tanpa reset bila:
 * - CI: database CI selalu baru, cukup migrate deploy;
 * - TEST_DB_NO_RESET=1: pemanggil ingin menerapkan migrasi saja (tidak menghapus data). Aman karena
 *   setiap test membuat data unik sendiri (tanpa truncate).
 */
export function shouldResetDatabase(flags: PrepareDbFlags): boolean {
  return !isFlagSet(flags.CI) && !isFlagSet(flags.TEST_DB_NO_RESET);
}

/** Reset: drop + buat ulang + semua migrasi (Prisma 7 tidak menjalankan seed saat reset). */
export function migrateCommand(reset: boolean): MigrateCommand {
  return reset
    ? { args: ["prisma", "migrate", "reset", "--force"], label: "Mereset database test (prisma migrate reset --force)" }
    : { args: ["prisma", "migrate", "deploy"], label: "Menerapkan migrasi (prisma migrate deploy)" };
}

/**
 * Baris perintah statis untuk dijalankan lewat shell (cmd.exe di Windows, /bin/sh di Linux).
 * Argumen berasal dari konstanta di atas, bukan input pengguna, jadi aman digabung.
 */
export function commandLine(command: MigrateCommand): string {
  return ["npx", ...command.args].join(" ");
}
