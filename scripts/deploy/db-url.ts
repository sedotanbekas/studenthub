/**
 * Pengurai DATABASE_URL untuk skrip deploy (di luar Prisma).
 *
 * Dipakai `scripts/deploy/db-name.ts` (penjaga nama database saat deploy) dan
 * `scripts/deploy/db-backup-cnf.ts` (berkas kredensial untuk mariadb-dump). Password di URL ditulis
 * ter-URL-encode (lihat .env.example): `@ : / #` di dalamnya salah terbaca bila URL dipotong dengan
 * regex, jadi URL diurai lewat WHATWG `URL` lalu di-decode per bagian.
 *
 * Modul ini murni (tanpa I/O) agar bisa diuji unit. Pesan error TIDAK PERNAH memuat user/password:
 * barisnya bisa mendarat di log GitHub Actions.
 */

export type DatabaseConnection = {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
  readonly database: string;
};

const DEFAULT_PORT = 3306;

/** Nama database aman untuk argumen mariadb-dump & nama berkas: tidak diawali "-", maks 64 karakter. */
const SAFE_DATABASE_NAME = /^[A-Za-z0-9_$][A-Za-z0-9_$-]{0,63}$/;

/** Karakter kontrol (termasuk CR/LF) akan memecah baris berkas opsi klien MySQL. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function parseUrl(value: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new Error("DATABASE_URL bukan URL yang sah");
  }
}

function decodePart(raw: string, label: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error(`DATABASE_URL memuat encoding persen yang tidak sah pada ${label}`);
  }
  if (CONTROL_CHARS.test(decoded)) {
    throw new Error(`DATABASE_URL memuat karakter kontrol pada ${label}`);
  }
  return decoded;
}

/** WHATWG mengembalikan host IPv6 lengkap dengan kurung siku; klien MySQL memerlukannya tanpa kurung. */
function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function parseDatabaseName(pathname: string): string {
  const database = decodePart(pathname.replace(/^\/+/, ""), "nama database");
  if (!database) throw new Error("DATABASE_URL tidak menyebut nama database");
  if (!SAFE_DATABASE_NAME.test(database)) {
    throw new Error(
      "DATABASE_URL memuat nama database yang tidak sah (hanya huruf, angka, _, $, -; maks 64 karakter; tidak diawali -)",
    );
  }
  return database;
}

/**
 * Mengurai DATABASE_URL berskema `mysql://` menjadi komponen koneksi.
 * Melempar Error (pesan Bahasa Indonesia, tanpa kredensial) bila URL tidak dapat dipakai.
 */
export function parseDatabaseUrl(value: string): DatabaseConnection {
  const url = parseUrl(value);
  if (url.protocol !== "mysql:") {
    throw new Error(`DATABASE_URL harus berskema mysql:// (didapat ${url.protocol}//)`);
  }
  // Skema `mysql:` bukan skema "spesial" WHATWG: bentuk tanpa `//` (mysql:u:p@h/db) atau tanpa host
  // (mysql:///db) tetap terurai tanpa melempar tetapi hostname-nya kosong. Tanpa penolakan ini,
  // klien dump diam-diam menyambung ke socket lokal dan mencadangkan database yang salah.
  if (!url.hostname) throw new Error("DATABASE_URL tidak menyebut host (kurang `//`?)");
  const user = decodePart(url.username, "user");
  if (!user) throw new Error("DATABASE_URL tidak menyebut user");
  return {
    host: decodePart(stripIpv6Brackets(url.hostname), "host"),
    port: url.port ? Number.parseInt(url.port, 10) : DEFAULT_PORT,
    user,
    password: decodePart(url.password, "password"),
    database: parseDatabaseName(url.pathname),
  };
}

/** Nilai my.cnf dibungkus kutip ganda; backslash dan kutip di dalamnya di-escape (MariaDB & MySQL). */
function quoteCnfValue(raw: string): string {
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Isi berkas opsi klien (`--defaults-extra-file`). Password lewat berkas, bukan argumen `-p`, agar
 * tidak terbaca di `ps` maupun log. Nama database sengaja tidak ikut: ia argumen posisi dump.
 */
export function toMysqlClientCnf(conn: DatabaseConnection): string {
  return [
    "[client]",
    `host=${quoteCnfValue(conn.host)}`,
    `port=${conn.port}`,
    `user=${quoteCnfValue(conn.user)}`,
    `password=${quoteCnfValue(conn.password)}`,
    "",
  ].join("\n");
}
