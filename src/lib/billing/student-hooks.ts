import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import type { LocalDate } from "@/lib/time/zone";
import { REASON_MAX } from "./constants";
import { readInvoiceState, writeInvoiceVoid } from "./invoice-state";
import { periodKeyOfDate } from "./period-rules";

/**
 * Kait billing yang dipanggil domain siswa saat siswa berstatus PINDAH (MOVED), di DALAM transaksi
 * perubahan status (pemanggil sudah memegang Student FOR UPDATE). Tagihan UNPAID milik siswa dengan periode
 * SETELAH bulan `todayLocal` dan tanpa bukti transfer menunggu dikunci (Invoice FOR UPDATE, id naik), lalu
 * di-VOID dengan alasan yang diberikan (audit + notifikasi INVOICE_VOIDED). Tagihan bulan ini & sebelumnya
 * tetap sebagai tunggakan. Mengembalikan id tagihan yang di-void.
 *
 * Catatan: pemanggil menonaktifkan User siswa lebih dulu, sehingga notifyStudents (hanya user aktif) tidak
 * membuat baris notifikasi untuk siswa pindah — audit tetap tercatat.
 */
export interface VoidFutureInvoicesInput {
  readonly schoolId: string;
  readonly studentId: string;
  readonly todayLocal: LocalDate;
  readonly reason: string;
}

async function lockFutureUnpaid(tx: Tx, input: VoidFutureInvoicesInput): Promise<string[]> {
  const todayKey = periodKeyOfDate(input.todayLocal);
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Invoice\`
    WHERE \`schoolId\` = ${input.schoolId} AND \`studentId\` = ${input.studentId} AND \`status\` = 'UNPAID'
      AND (\`periodYear\` * 12 + \`periodMonth\` - 1) > ${todayKey}
    ORDER BY \`id\` FOR UPDATE`;
  return rows.map((row) => row.id);
}

export async function voidFutureInvoicesForStudent(tx: Tx, input: VoidFutureInvoicesInput, ctx: ActionContext): Promise<string[]> {
  const ids = await lockFutureUnpaid(tx, input);
  const reason = input.reason.trim().slice(0, REASON_MAX) || "Siswa pindah";
  const voided: string[] = [];
  for (const id of ids) {
    const invoice = await readInvoiceState(tx, input.schoolId, id);
    if (invoice.status !== "UNPAID" || invoice.paidAmount !== 0 || invoice.pendingSubmissionId !== null) continue;
    await writeInvoiceVoid(tx, { invoice, reason, source: "student_moved" }, ctx);
    voided.push(id);
  }
  return voided;
}
