/**
 * Menulis berkas opsi klien MySQL/MariaDB (`--defaults-extra-file`) dari DATABASE_URL.
 *
 * Dipanggil `scripts/deploy/backup-db.sh` dengan path hasil `mktemp`. Blok `[client]` (host, port,
 * user, password ter-decode) ditulis dengan mode 0600, lalu NAMA DATABASE dicetak ke stdout — satu-
 * satunya nilai yang perlu diketahui shell. Password tidak pernah lewat argumen proses, variabel
 * shell, maupun log.
 *
 *   pnpm exec tsx scripts/deploy/db-backup-cnf.ts /tmp/tmp.XXXXXX
 */
import { closeSync, fchmodSync, fstatSync, openSync, writeSync } from "node:fs";
import { exitWithError, loadDatabaseConnection } from "./cli-env";
import { toMysqlClientCnf } from "./db-url";

const SCRIPT = "db-backup-cnf";
const PRIVATE_MODE = 0o600;

/** Mode 0600 dipasang SEBELUM isi ditulis, juga bila berkas sudah ada dengan mode lebih longgar. */
function writePrivateFile(path: string, content: string): void {
  const fd = openSync(path, "w", PRIVATE_MODE);
  try {
    if (fstatSync(fd).isFile()) fchmodSync(fd, PRIVATE_MODE);
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
}

const target = process.argv[2];
if (!target) exitWithError(SCRIPT, "pemakaian: tsx scripts/deploy/db-backup-cnf.ts <path-berkas-cnf>");

const connection = loadDatabaseConnection(SCRIPT);
writePrivateFile(target, toMysqlClientCnf(connection));
process.stdout.write(`${connection.database}\n`);
