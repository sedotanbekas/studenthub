import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import { ADMIN_MUTABLE_CATEGORIES, diffMutedCategories, normalizeMutedCategories, type AdminMutableCategory } from "./rules";
import type { NotificationPreferencesDto, UpdateNotificationPreferencesBody } from "./schemas";

/**
 * Pilihan kabar sekolah per akun admin (N2). Tabel NotificationMute tidak ber-schoolId: userId SELALU berasal dari
 * principal (/me) atau dari getSchoolAdmin yang sudah lolos SchoolScope (/school/admins/{id}). Ganti penuh (PUT)
 * di bawah AppLock user (serialisasi PUT bersamaan), audit `user.notification_mutes` di transaksi yang sama.
 */
export const MUTES_AUDIT_ACTION = "user.notification_mutes";

export async function readNotificationMutes(userId: string, db: Tx = prisma): Promise<AdminMutableCategory[]> {
  const rows = await db.notificationMute.findMany({ where: { userId }, select: { category: true }, take: 20 });
  return normalizeMutedCategories(rows.map((r) => r.category));
}

/** Ganti set kategori yang dimatikan; set sama -> tanpa tulis & tanpa audit. Mengembalikan set tersimpan baru. */
export async function replaceNotificationMutes(userId: string, schoolId: string | null, requested: readonly AdminMutableCategory[], ctx: ActionContext): Promise<AdminMutableCategory[]> {
  const next = normalizeMutedCategories(requested);
  return withTx(async (tx) => {
    await lockKey(tx, userLockKey(userId));
    const stored = (await tx.notificationMute.findMany({ where: { userId }, select: { category: true }, take: 20 })).map((r) => r.category);
    const { added, removed } = diffMutedCategories(stored, next);
    if (added.length === 0 && removed.length === 0) return next;
    if (removed.length) await tx.notificationMute.deleteMany({ where: { userId, category: { in: removed } } });
    if (added.length) await tx.notificationMute.createMany({ data: added.map((category) => ({ userId, category, createdAt: ctx.now })) });
    await writeAudit(
      tx,
      { action: MUTES_AUDIT_ACTION, entityType: "User", entityId: userId, schoolId, before: { mutedCategories: normalizeMutedCategories(stored) }, after: { mutedCategories: next } },
      ctx,
    );
    return next;
  });
}

/** Perubahan terakhir (dari audit): siapa & kapan — agar akun yang diatur admin utama tahu sebabnya. */
async function lastChange(userId: string): Promise<Pick<NotificationPreferencesDto, "updatedAt" | "updatedBy">> {
  const audit = await prisma.auditLog.findFirst({
    where: { entityType: "User", entityId: userId, action: MUTES_AUDIT_ACTION },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, actor: { select: { id: true, name: true } } },
  });
  return { updatedAt: audit?.createdAt.toISOString() ?? null, updatedBy: audit?.actor ?? null };
}

export async function notificationPreferencesOf(userId: string): Promise<NotificationPreferencesDto> {
  const [mutedCategories, change] = await Promise.all([readNotificationMutes(userId), lastChange(userId)]);
  return { mutedCategories, mutableCategories: [...ADMIN_MUTABLE_CATEGORIES], ...change };
}

/** GET /me/notification-preferences. */
export function getMyNotificationPreferences(ctx: ActionContext): Promise<NotificationPreferencesDto> {
  return notificationPreferencesOf(requirePrincipal(ctx).userId);
}

/** PUT /me/notification-preferences. */
export async function updateMyNotificationPreferences(input: UpdateNotificationPreferencesBody, ctx: ActionContext): Promise<NotificationPreferencesDto> {
  const principal = requirePrincipal(ctx);
  await replaceNotificationMutes(principal.userId, principal.schoolId ?? null, input.mutedCategories, ctx);
  return notificationPreferencesOf(principal.userId);
}
