/**
 * Akses database untuk integration test. Memakai klien aplikasi yang sama (src/lib/db.ts) agar
 * initSql time_zone, omit passwordHash, dan adapter MariaDB ikut teruji.
 *
 * Pola per berkas test:
 *   import { after } from "node:test";
 *   import { disconnect } from "../helpers/db";
 *   after(disconnect);
 */
import { randomBytes } from "node:crypto";
import { prisma } from "../../../src/lib/db";

export { prisma };
export type { Db, Tx } from "../../../src/lib/db";

let counter = 0;

/**
 * String pendek unik lintas proses & lintas run, mis. uniq("sch") -> "sch-mfu2k9x01a3f9c".
 * Panjang = prefix + 16 karakter; jaga prefix pendek untuk kolom sempit (Subject.code VarChar(20)).
 */
export function uniq(prefix = "t"): string {
  counter += 1;
  const time = Date.now().toString(36).slice(-8);
  const seq = (counter % 1296).toString(36).padStart(2, "0");
  return `${prefix}-${time}${seq}${randomBytes(3).toString("hex")}`;
}

/** Tutup pool koneksi agar proses test bisa keluar. Pasang di `after(disconnect)`. */
export async function disconnect(): Promise<void> {
  await prisma.$disconnect();
}
