import { Prisma, prisma, type Tx } from "./db";
import { log } from "./log";

/**
 * Transaksi interaktif dengan retry pada bentrokan/deadlock (P2034).
 *
 * URUTAN KUNCI GLOBAL (wajib diikuti semua domain untuk mencegah deadlock):
 *   AppLock (kunci aplikasi) -> Student (id naik) -> LeaveRequest -> Attendance -> ReportCard
 *   -> Invoice (id naik) -> PaymentSubmission -> Payment -> DocumentCounter
 *   Terpisah: Sponsor -> Ad / TopUpRequest -> AdDailyStat.
 *   Notification & AuditLog selalu ditulis TERAKHIR.
 * JANGAN pernah `FOR UPDATE` baris School/SchoolClass sebagai mutex (baris induk sibuk karena cek FK);
 * pakai lockKey() dengan kunci bernama.
 */
export const TX_DEFAULTS = { timeout: 20_000, maxWait: 10_000 } as const;
const MAX_RETRIES = 3;

export type TxOptions = {
  timeout?: number;
  maxWait?: number;
  retries?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

function isRetryable(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2034";
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withTx<T>(fn: (tx: Tx) => Promise<T>, options: TxOptions = {}): Promise<T> {
  const retries = options.retries ?? MAX_RETRIES;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => fn(tx as Tx), {
        timeout: options.timeout ?? TX_DEFAULTS.timeout,
        maxWait: options.maxWait ?? TX_DEFAULTS.maxWait,
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      });
    } catch (error) {
      if (!isRetryable(error) || attempt > retries) throw error;
      log.warn("tx.retry", { attempt });
      await pause(25 * attempt + Math.floor(Math.random() * 25));
    }
  }
}

/** Kunci aplikasi bernama (mutex dalam transaksi), mis. "grades:<termId>:<classId>". */
export async function lockKey(tx: Tx, key: string): Promise<void> {
  if (key.length === 0 || key.length > 191) throw new Error("Kunci lock tidak valid");
  await tx.$executeRaw`INSERT INTO \`AppLock\` (\`key\`, \`updatedAt\`) VALUES (${key}, UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE \`key\` = \`key\``;
  await tx.$queryRaw`SELECT \`key\` FROM \`AppLock\` WHERE \`key\` = ${key} FOR UPDATE`;
}

const LOCKABLE_TABLES = [
  "Student", "LeaveRequest", "Attendance", "ReportCard", "Invoice", "PaymentSubmission", "Payment", "Sponsor", "Ad", "TopUpRequest", "Announcement",
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
