import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";

/**
 * Kunci baris domain SPP, selalu dengan filter sekolah. Urutan global (src/lib/tx.ts):
 * Student (BERSAMA, id naik) -> Invoice (id naik) -> PaymentSubmission -> Payment -> DocumentCounter;
 * Notification & AuditLog terakhir.
 *
 * Student dikunci mode BERSAMA di setiap transaksi SPP yang menyentuh tagihan: transisi status siswa
 * (lifecycle) memegang Student FOR UPDATE lalu User lalu Invoice, sedangkan tulisan SPP menyisipkan baris
 * ber-FK ke Student/User siswa (Invoice, PaymentSubmission, Notification). Tanpa kunci Student lebih dulu,
 * kedua jalur bisa saling menunggu (deadlock). Kunci bersama tidak saling menghalangi antar-transaksi SPP.
 */
export const invoiceNotFound = () => notFound("Tagihan tidak ditemukan.");
export const studentNotFound = () => notFound("Siswa tidak ditemukan.");
export const submissionNotFound = () => notFound("Bukti transfer tidak ditemukan.");
export const paymentNotFound = () => notFound("Pembayaran tidak ditemukan.");

/** Student LOCK IN SHARE MODE (id naik) dalam sekolah; mengembalikan id yang ada. */
export async function lockStudentsShared(tx: Tx, schoolId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const sorted = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Student\`
    WHERE \`schoolId\` = ${schoolId} AND \`id\` IN (${Prisma.join(sorted)}) ORDER BY \`id\` LOCK IN SHARE MODE`;
  return rows.map((row) => row.id);
}

export async function lockStudentShared(tx: Tx, schoolId: string, studentId: string): Promise<void> {
  const locked = await lockStudentsShared(tx, schoolId, [studentId]);
  if (locked.length === 0) throw studentNotFound();
}

export interface InvoiceLockTarget {
  readonly id: string;
  readonly schoolId: string;
  /** Diisi untuk aksi siswa: tagihan milik siswa lain -> 404. */
  readonly studentId?: string;
}

export async function lockInvoice(tx: Tx, target: InvoiceLockTarget): Promise<void> {
  const byStudent = target.studentId === undefined ? Prisma.empty : Prisma.sql`AND \`studentId\` = ${target.studentId}`;
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Invoice\`
    WHERE \`id\` = ${target.id} AND \`schoolId\` = ${target.schoolId} ${byStudent} FOR UPDATE`;
  if (rows.length === 0) throw invoiceNotFound();
}

export async function lockSubmission(tx: Tx, schoolId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`PaymentSubmission\`
    WHERE \`id\` = ${id} AND \`schoolId\` = ${schoolId} FOR UPDATE`;
  if (rows.length === 0) throw submissionNotFound();
}

export async function lockPayment(tx: Tx, schoolId: string, id: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Payment\` WHERE \`id\` = ${id} AND \`schoolId\` = ${schoolId} FOR UPDATE`;
  if (rows.length === 0) throw paymentNotFound();
}

/** Student (bersama) -> Invoice (eksklusif): pembuka standar setiap mutasi satu tagihan. */
export async function lockStudentAndInvoice(tx: Tx, target: InvoiceLockTarget & { readonly studentId: string }): Promise<void> {
  await lockStudentShared(tx, target.schoolId, target.studentId);
  await lockInvoice(tx, target);
}
