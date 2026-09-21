import type { Tx } from "@/lib/db";
import { holidaysLockKey } from "@/lib/lock-keys";
import { lockKeyShared } from "@/lib/tx";

/**
 * Kalender satu sekolah dikunci BERSAMA (libur nasional lalu libur sekolah; urutan src/lib/lock-keys.ts):
 * penulis baris turunan kalender (penutupan hari auto-ALPHA, materialisasi izin) menahan mutasi libur di
 * antara baca kalender dan INSERT tanpa saling menunggu. Dipanggil PALING AWAL di transaksi.
 */
export async function lockCalendarShared(tx: Tx, schoolId: string): Promise<void> {
  await lockKeyShared(tx, holidaysLockKey(null));
  await lockKeyShared(tx, holidaysLockKey(schoolId));
}
