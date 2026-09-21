import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import type { LocalDate } from "@/lib/time/zone";

/**
 * Kait billing yang dipanggil domain siswa saat siswa berstatus PINDAH (MOVED), di DALAM transaksi
 * perubahan status. STUB fase P1: mengembalikan []. Fase P3 (billing) mengimplementasikannya:
 * void tagihan UNPAID milik siswa dengan periode >= bulan `todayLocal` (tanpa pembayaran/pengajuan
 * pending), kunci Invoice id naik (setelah Student sesuai urutan kunci global), audit + notifikasi
 * INVOICE_VOIDED, lalu kembalikan id tagihan yang di-void.
 */
export interface VoidFutureInvoicesInput {
  readonly schoolId: string;
  readonly studentId: string;
  readonly todayLocal: LocalDate;
  readonly reason: string;
}

export async function voidFutureInvoicesForStudent(
  _tx: Tx,
  _input: VoidFutureInvoicesInput,
  _ctx: ActionContext,
): Promise<string[]> {
  return [];
}
