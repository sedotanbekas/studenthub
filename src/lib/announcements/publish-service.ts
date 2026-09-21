import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { unprocessable } from "@/lib/http/errors";
import { notifyRecipients } from "@/lib/notifications/notify";
import { announcementPublishedNotification } from "@/lib/notifications/templates/announcements";
import { withTx } from "@/lib/tx";
import { AUDIT_ENTITY } from "./constants";
import { audienceOf } from "./dto";
import { loadAnnouncementDetail } from "./queries";
import { announcementScopeOf, assertAction, findRecipientUserIds, lockAnnouncement, stateConflict, type LockedAnnouncement } from "./records";
import { normalizeAudience } from "./rules";
import type { AnnouncementDetailDto, CancelAnnouncementInput } from "./schemas";

/**
 * Terbit & tarik pengumuman. Urutan kunci: Announcement FOR UPDATE (baca ulang) -> CAS status ->
 * Notification (fan-out / hapus) -> AuditLog (terakhir, src/lib/tx.ts). Semua dalam satu withTx.
 */

/**
 * DRAFT -> PUBLISHED dalam transaksi pemanggil (baris sudah dikunci/baru dibuat): penerima = siswa ACTIVE
 * berakun aktif yang cocok audiens SAAT INI; 0 penerima -> 422 NO_RECIPIENTS (rollback). Fan-out lewat
 * notifyRecipients (idempoten per userId+announcementId) lalu kick push setelah respons.
 */
export async function publishLocked(tx: Tx, row: LockedAnnouncement, ctx: ActionContext): Promise<number> {
  const userIds = await findRecipientUserIds(tx, row.schoolId, normalizeAudience(audienceOf(row)));
  if (userIds.length === 0) {
    throw unprocessable("NO_RECIPIENTS", "Tidak ada siswa aktif yang menjadi penerima pengumuman ini.");
  }
  const cas = await tx.announcement.updateMany({
    where: { id: row.id, schoolId: row.schoolId, status: "DRAFT" },
    data: { status: "PUBLISHED", publishedAt: ctx.now, recipientCount: userIds.length },
  });
  if (cas.count !== 1) throw stateConflict();
  const event = announcementPublishedNotification({ id: row.id, category: row.category, title: row.title, body: row.body });
  await notifyRecipients(tx, userIds.map((userId) => ({ userId, role: "STUDENT" as const })), event, ctx);
  await writeAudit(
    tx,
    {
      action: "announcement.publish",
      entityType: AUDIT_ENTITY,
      entityId: row.id,
      schoolId: row.schoolId,
      before: { status: row.status },
      after: { status: "PUBLISHED", recipientCount: userIds.length, audience: row.audience, category: row.category, title: row.title },
    },
    ctx,
  );
  return userIds.length;
}

export async function publishAnnouncement(ctx: ActionContext, schoolId: string | undefined, id: string): Promise<AnnouncementDetailDto> {
  const scope = announcementScopeOf(ctx, schoolId);
  return withTx(async (tx) => {
    const row = await lockAnnouncement(tx, scope, id);
    assertAction(row, "publish");
    await publishLocked(tx, row, ctx);
    return loadAnnouncementDetail(tx, scope, id);
  });
}

/** Tarik pengumuman terbit: CANCELLED + hapus seluruh notifikasinya (push yang belum terkirim ikut mati). */
async function retractLocked(tx: Tx, row: LockedAnnouncement, reason: string | null, ctx: ActionContext): Promise<void> {
  const cas = await tx.announcement.updateMany({
    where: { id: row.id, schoolId: row.schoolId, status: "PUBLISHED" },
    data: { status: "CANCELLED", cancelledAt: ctx.now },
  });
  if (cas.count !== 1) throw stateConflict();
  const removed = await tx.notification.deleteMany({ where: { announcementId: row.id } });
  await writeAudit(
    tx,
    {
      action: "announcement.retract",
      entityType: AUDIT_ENTITY,
      entityId: row.id,
      schoolId: row.schoolId,
      before: { status: row.status, recipientCount: row.recipientCount },
      after: { status: "CANCELLED", reason, removedNotifications: removed.count },
    },
    ctx,
  );
}

/** Batalkan draf (tanpa notifikasi). */
async function cancelDraftLocked(tx: Tx, row: LockedAnnouncement, reason: string | null, ctx: ActionContext): Promise<void> {
  const cas = await tx.announcement.updateMany({
    where: { id: row.id, schoolId: row.schoolId, status: "DRAFT" },
    data: { status: "CANCELLED", cancelledAt: ctx.now },
  });
  if (cas.count !== 1) throw stateConflict();
  await writeAudit(
    tx,
    { action: "announcement.cancel", entityType: AUDIT_ENTITY, entityId: row.id, schoolId: row.schoolId, before: { status: row.status }, after: { status: "CANCELLED", reason } },
    ctx,
  );
}

export async function cancelAnnouncement(
  ctx: ActionContext,
  schoolId: string | undefined,
  id: string,
  input: CancelAnnouncementInput,
): Promise<AnnouncementDetailDto> {
  const scope = announcementScopeOf(ctx, schoolId);
  const reason = input.reason ? input.reason : null;
  return withTx(async (tx) => {
    const row = await lockAnnouncement(tx, scope, id);
    assertAction(row, "cancel");
    if (row.status === "PUBLISHED") await retractLocked(tx, row, reason, ctx);
    else await cancelDraftLocked(tx, row, reason, ctx);
    return loadAnnouncementDetail(tx, scope, id);
  });
}
