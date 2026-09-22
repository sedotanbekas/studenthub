import { Prisma, prisma, type Tx } from "./db";
import { log } from "./log";

/**
 * Transaksi interaktif dengan retry pada bentrokan/deadlock (P2034).
 *
 * URUTAN KUNCI GLOBAL (wajib diikuti semua domain untuk mencegah deadlock):
 *   AppLock (kunci aplikasi) -> Student (id naik) -> LeaveRequest -> Attendance -> ReportCard
 *   -> Invoice (id naik) -> PaymentSubmission (+ PaymentProofMatch) -> Payment -> DocumentCounter
 *   Terpisah (sponsor & iklan): AppLock banner (bannerLockKey) -> Sponsor -> Ad / TopUpRequest -> StoredFile
 *   (banner) -> AdTarget -> AdClick -> SponsorLedgerEntry -> AdDailyStat. Setiap perubahan saldo (klik, top-up,
 *   penyesuaian) mengunci baris Sponsor PALING AWAL (src/lib/sponsors/ledger.ts).
 *   Notification & AuditLog selalu ditulis TERAKHIR.
 * JANGAN pernah `FOR UPDATE` baris School/SchoolClass sebagai mutex (baris induk sibuk karena cek FK);
 * pakai lockKey() dengan kunci bernama. Kunci aplikasi (src/lib/lock-keys.ts) diambil PALING AWAL,
 * sebelum membaca apa pun.
 *
 * ISOLASI DEFAULT = READ COMMITTED. Service mengambil lockKey()/FOR UPDATE lalu MEMBACA ULANG data.
 * Di REPEATABLE READ (default InnoDB) snapshot dibuat pada baca pertama transaksi, sehingga baca
 * ulang setelah menunggu kunci tetap melihat data basi -> terbukti menimbulkan lost update & duplikat.
 * READ COMMITTED membuat setiap baca melihat commit terbaru. Syarat server: binlog_format ROW/MIXED
 * (STATEMENT menolak tulis InnoDB di READ COMMITTED).
 */
export const TX_DEFAULTS = { timeout: 20_000, maxWait: 10_000 } as const;
const MAX_RETRIES = 3;
const DEFAULT_ISOLATION = Prisma.TransactionIsolationLevel.ReadCommitted;

export type TxOptions = {
  timeout?: number;
  maxWait?: number;
  retries?: number;
  /** Default READ COMMITTED (lihat catatan di atas). */
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

/** errno MariaDB: 1213 deadlock, 1205 lock wait timeout. */
const LOCK_FAILURE_ERRNOS = new Set(["1213", "1205"]);
const LOCK_FAILURE_TEXT = /Code: `(?:1213|1205)`|deadlock|lock wait timeout/i;

type DbErrorLike = {
  code?: unknown;
  message?: unknown;
  meta?: { code?: unknown; message?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown; originalMessage?: unknown } } };
};

/** Query mentah ($queryRaw/$executeRaw) melaporkan deadlock/lock wait sebagai P2010 + errno di meta/pesan. */
function isRawLockFailure(error: DbErrorLike): boolean {
  const cause = error.meta?.driverAdapterError?.cause;
  const codes = [error.meta?.code, cause?.originalCode].map((value) => String(value ?? ""));
  if (codes.some((value) => LOCK_FAILURE_ERRNOS.has(value))) return true;
  const texts = [error.message, error.meta?.message, cause?.originalMessage];
  return texts.some((text) => typeof text === "string" && LOCK_FAILURE_TEXT.test(text));
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const dbError = error as DbErrorLike;
  if (dbError.code === "P2034") return true;
  return dbError.code === "P2010" && isRawLockFailure(dbError);
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withTx<T>(fn: (tx: Tx) => Promise<T>, options: TxOptions = {}): Promise<T> {
  const retries = options.retries ?? MAX_RETRIES;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => fn(tx as Tx), {
        timeout: options.timeout ?? TX_DEFAULTS.timeout,
        maxWait: options.maxWait ?? TX_DEFAULTS.maxWait,
        isolationLevel: options.isolationLevel ?? DEFAULT_ISOLATION,
      });
    } catch (error) {
      if (!isRetryable(error) || attempt > retries) throw error;
      log.warn("tx.retry", { attempt, code: (error as DbErrorLike).code });
      await pause(25 * attempt + Math.floor(Math.random() * 25));
    }
  }
}

function assertLockKey(key: string): void {
  if (key.length === 0 || key.length > 191) throw new Error("Kunci lock tidak valid");
}

/** Kunci aplikasi bernama (mutex dalam transaksi), mis. "grades:<termId>:<classId>". */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  assertLockKey(key);
  await tx.$executeRaw`INSERT INTO \`AppLock\` (\`key\`, \`updatedAt\`) VALUES (${key}, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE \`key\` = \`key\``;
  await tx.$queryRaw`SELECT \`key\` FROM \`AppLock\` WHERE \`key\` = ${key} FOR UPDATE`;
}

/**
 * Kunci aplikasi mode BERSAMA (LOCK IN SHARE MODE): pembaca yang hanya perlu menahan penulis (lockKey
 * eksklusif) tanpa saling menunggu, mis. persetujuan izin & penutupan hari terhadap mutasi libur.
 * Baris AppLock dibuat bila belum ada (INSERT IGNORE tidak mengambil kunci eksklusif atas baris yang sudah
 * ada). Jangan pernah menaikkan kunci bersama menjadi eksklusif pada key yang sama dalam satu transaksi.
 */
export async function lockKeyShared(tx: Tx, key: string): Promise<void> {
  assertLockKey(key);
  const rows = await tx.$queryRaw<Array<{ key: string }>>`SELECT \`key\` FROM \`AppLock\` WHERE \`key\` = ${key} LOCK IN SHARE MODE`;
  if (rows.length > 0) return;
  await tx.$executeRaw`INSERT IGNORE INTO \`AppLock\` (\`key\`, \`updatedAt\`) VALUES (${key}, UTC_TIMESTAMP(3))`;
  await tx.$queryRaw`SELECT \`key\` FROM \`AppLock\` WHERE \`key\` = ${key} LOCK IN SHARE MODE`;
}

const LOCKABLE_TABLES = [
  "Student", "LeaveRequest", "Attendance", "ReportCard", "Invoice", "PaymentSubmission", "Payment", "Sponsor", "Ad", "TopUpRequest", "Announcement", "StoredFile",
] as const;
export type LockableTable = (typeof LOCKABLE_TABLES)[number];

/** SELECT ... FOR UPDATE atas id terurut naik (urutan kunci deterministik). */
export async function lockRows(tx: Tx, table: LockableTable, ids: readonly string[]): Promise<string[]> {
  if (!LOCKABLE_TABLES.includes(table)) throw new Error(`Tabel ${table} tidak boleh dikunci`);
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT \`id\` FROM \`${table}\` WHERE \`id\` IN (${sorted.map(() => "?").join(",")}) ORDER BY \`id\` FOR UPDATE`,
    ...sorted,
  );
  return rows.map((r) => r.id);
}
