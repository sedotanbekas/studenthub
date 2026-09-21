import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { notFound } from "@/lib/http/errors";
import { withTx } from "@/lib/tx";
import { buildReadAllWhere, readAllBound } from "./inbox-filters";
import { NOTIFICATION_NOT_FOUND } from "./queries";
import type { MarkReadDto, ReadAllBody, ReadAllDto } from "./schemas";

/**
 * Mutasi status baca inbox (desain N8). Tanpa audit: status baca bukan data bisnis.
 * Dijalankan lewat withTx agar deadlock (P2034) dengan fan-out yang bersamaan di-retry.
 */

/**
 * Tandai satu item dibaca, aman diulang: compare-and-set `readAt IS NULL`. Bila 0 baris berubah:
 * bukan milik pemanggil / tidak ada -> 404; sudah dibaca -> 200 dengan readAt yang tersimpan.
 */
export async function markRead(id: string, ctx: ActionContext): Promise<MarkReadDto> {
  const { userId } = requirePrincipal(ctx);
  return withTx(async (tx) => {
    const { count } = await tx.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: ctx.now } });
    if (count === 1) return { id, readAt: ctx.now.toISOString() };
    const row = await tx.notification.findFirst({ where: { id, userId }, select: { readAt: true } });
    if (!row?.readAt) throw notFound(NOTIFICATION_NOT_FOUND);
    return { id, readAt: row.readAt.toISOString() };
  });
}

/** Tandai semua dibaca hingga batas `before` (tidak melewati now), opsional per kind. */
export async function markAllRead(input: ReadAllBody, ctx: ActionContext): Promise<ReadAllDto> {
  const { userId } = requirePrincipal(ctx);
  const where = buildReadAllWhere({ userId, kind: input.kind ?? "all", bound: readAllBound(input.before, ctx.now) });
  const { count } = await withTx((tx) => tx.notification.updateMany({ where, data: { readAt: ctx.now } }));
  return { updated: count };
}
