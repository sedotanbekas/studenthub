import type { Tx } from "@/lib/db";
import { documentNumberRange, type DocumentKindValue } from "./document-number";

/**
 * Penghitung nomor dokumen per (sekolah, jenis, tahun lokal) di DALAM transaksi pemanggil:
 * INSERT ... ON DUPLICATE KEY UPDATE (kunci eksklusif baris, dibuat bila belum ada) lalu SELECT ... FOR UPDATE.
 * Rollback transaksi ikut mengembalikan penghitung -> nomor tanpa celah. DocumentCounter adalah kunci
 * TERAKHIR dalam urutan kunci global (src/lib/tx.ts). Waktu dari ctx.now (tanpa NOW() di SQL).
 */
export interface CounterKey {
  readonly schoolId: string;
  readonly kind: DocumentKindValue;
  readonly year: number;
}

export interface AllocatedNumbers {
  readonly first: number;
  readonly last: number;
  readonly numbers: readonly string[];
}

export const MAX_ALLOCATION = 3_000;

/** DATETIME(3) UTC eksplisit (sesi DB time_zone +00:00) agar tidak bergantung konversi driver. */
const sqlDateTime = (instant: Date): string => instant.toISOString().slice(0, 23).replace("T", " ");

async function bump(tx: Tx, key: CounterKey, delta: number, now: Date): Promise<number> {
  await tx.$executeRaw`INSERT INTO \`DocumentCounter\` (\`schoolId\`, \`kind\`, \`year\`, \`lastValue\`, \`updatedAt\`)
    VALUES (${key.schoolId}, ${key.kind}, ${key.year}, ${delta}, ${sqlDateTime(now)})
    ON DUPLICATE KEY UPDATE \`lastValue\` = \`lastValue\` + VALUES(\`lastValue\`), \`updatedAt\` = VALUES(\`updatedAt\`)`;
  const rows = await tx.$queryRaw<Array<{ lastValue: number | bigint }>>`SELECT \`lastValue\` FROM \`DocumentCounter\`
    WHERE \`schoolId\` = ${key.schoolId} AND \`kind\` = ${key.kind} AND \`year\` = ${key.year} FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error("Baris DocumentCounter tidak ditemukan setelah upsert");
  return Number(row.lastValue);
}

/** Kunci baris penghitung tanpa menaikkan (penagihan massal: kunci dulu, baru cek slot yang sudah ada). */
export function lockDocumentCounter(tx: Tx, key: CounterKey, now: Date): Promise<number> {
  return bump(tx, key, 0, now);
}

/** Alokasikan `count` nomor berurutan; mengembalikan rentang + nomor terformat. */
export async function allocateDocumentNumbers(tx: Tx, key: CounterKey, count: number, now: Date): Promise<AllocatedNumbers> {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ALLOCATION) throw new RangeError(`Jumlah nomor tidak valid: ${count}`);
  const last = await bump(tx, key, count, now);
  const first = last - count + 1;
  return { first, last, numbers: documentNumberRange(key.kind, key.year, first, count) };
}
