import { Prisma, prisma } from "@/lib/db";
import { withTx } from "@/lib/tx";
import { PUSH_BATCH, PUSH_CLAIM_LEASE_MS } from "./constants";

/**
 * Klaim outbox push tanpa kolom tambahan: dalam satu transaksi pendek, baris PENDING yang jatuh tempo
 * (terlama dulu) dikunci `FOR UPDATE SKIP LOCKED` lalu pushNextAttemptAt digeser ke `leaseUntil`.
 * Dispatcher lain melewati baris yang sedang dikunci dan, setelah commit, tidak lagi melihatnya jatuh
 * tempo — sehingga tiap notifikasi dikirim oleh tepat satu dispatcher. `leaseUntil` sekaligus penjaga
 * update akhir (where pushStatus = PENDING AND pushNextAttemptAt = leaseUntil).
 */
const CLAIM_SELECT = {
  id: true,
  userId: true,
  title: true,
  body: true,
  data: true,
  createdAt: true,
  pushAttempts: true,
} as const satisfies Prisma.NotificationSelect;

export type ClaimedNotification = Prisma.NotificationGetPayload<{ select: typeof CLAIM_SELECT }>;

export interface Claim {
  readonly rows: readonly ClaimedNotification[];
  readonly leaseUntil: Date;
}

const BATCH_LIMIT = Prisma.raw(String(PUSH_BATCH));

function userFilter(userIds: readonly string[] | null): Prisma.Sql {
  return userIds === null ? Prisma.empty : Prisma.sql`AND \`userId\` IN (${Prisma.join([...userIds])})`;
}

/** `userIds` null = seluruh DB (produksi); daftar = cakupan test (tidak boleh kosong). */
export async function claimPendingBatch(now: Date, userIds: readonly string[] | null): Promise<Claim> {
  if (userIds !== null && userIds.length === 0) throw new Error("Cakupan user kosong: jangan klaim");
  const leaseUntil = new Date(now.getTime() + PUSH_CLAIM_LEASE_MS);
  const rows = await withTx(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT \`id\` FROM \`Notification\`
      WHERE \`pushStatus\` = 'PENDING' AND \`pushNextAttemptAt\` <= ${now} ${userFilter(userIds)}
      ORDER BY \`pushNextAttemptAt\` LIMIT ${BATCH_LIMIT}
      FOR UPDATE SKIP LOCKED`;
    if (locked.length === 0) return [];
    const ids = locked.map((row) => row.id);
    await tx.notification.updateMany({ where: { id: { in: ids }, pushStatus: "PENDING" }, data: { pushNextAttemptAt: leaseUntil } });
    return tx.notification.findMany({ where: { id: { in: ids } }, select: CLAIM_SELECT, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  });
  return { rows, leaseUntil };
}

/** Pengguna dalam cakupan job (test). null = tanpa cakupan; [] = tidak menyentuh apa pun. */
export async function scopedUserIds(scope: { readonly schoolIds?: readonly string[]; readonly userIds?: readonly string[] } | undefined): Promise<string[] | null> {
  if (!scope) return null;
  const schoolIds = scope.schoolIds ?? [];
  const bySchool = schoolIds.length > 0 ? await prisma.user.findMany({ where: { schoolId: { in: [...schoolIds] } }, select: { id: true } }) : [];
  return [...new Set([...(scope.userIds ?? []), ...bySchool.map((u) => u.id)])];
}
