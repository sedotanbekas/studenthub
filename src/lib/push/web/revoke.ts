import type { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";

/**
 * Pencabutan sesi (N3): sesi yang dicabut tidak lagi dikirimi push (loader hanya sesi hidup), dan baris langganan Web
 * Push-nya dihapus di transaksi pencabutan yang sama agar endpoint (setara token) tidak tersimpan. Dipanggil SETELAH
 * AuthSession diperbarui (urutan kunci AuthSession -> WebPushSubscription). `where` memilih sesi yang baru dicabut.
 */
export async function forgetRevokedWebPush(tx: Tx, where: Prisma.AuthSessionWhereInput): Promise<number> {
  return (await tx.webPushSubscription.deleteMany({ where: { session: { ...where, revokedAt: { not: null } } } })).count;
}
