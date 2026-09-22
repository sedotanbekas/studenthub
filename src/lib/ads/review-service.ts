import type { AdStatus } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { bannerLockKey } from "@/lib/lock-keys";
import { notifySponsorMembers } from "@/lib/notifications/notify";
import { adApprovedNotification, adRejectedNotification } from "@/lib/notifications/templates/sponsors";
import { lockSponsor } from "@/lib/sponsors/ledger";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import { adNotFound, getPlatformAd } from "./ad-queries";
import { nextAdStatus, type AdAction } from "./ad-rules";
import { publishBannerInTx, syncBannerPublication } from "./banner-service";
import { adViolation, failAd } from "./errors";
import type { ReviewAdDto } from "./response-schemas";

/**
 * Review iklan oleh super admin. approve/reject = CAS pada status PENDING_REVIEW DAN submittedAt yang dilihat
 * reviewer (versi yang disetujui persis versi yang ditinjau). approve menyalin banner ke bucket publik di
 * bawah bannerLockKey (urutan kunci: AppLock banner -> Sponsor -> Ad). takedown: APPROVED/PAUSED/PENDING_REVIEW
 * -> REJECTED; salinan publik dihapus setelah commit bila tak ada iklan aktif lain yang memakai banner itu.
 */
interface ReviewTarget {
  readonly sponsorId: string;
  readonly imageFileId: string;
}

interface LockedReview {
  readonly status: AdStatus;
  readonly title: string;
  readonly submittedAt: Date | null;
  readonly endAt: Date;
  readonly imageFileId: string;
  readonly sponsorStatus: string;
}

async function findTarget(id: string): Promise<ReviewTarget> {
  const ad = await prisma.ad.findFirst({ where: { id }, select: { sponsorId: true, imageFileId: true } });
  if (!ad) throw adNotFound();
  return ad;
}

async function lockForReview(tx: Tx, id: string, target: ReviewTarget, action: AdAction): Promise<LockedReview> {
  const sponsor = await lockSponsor(tx, target.sponsorId);
  await lockRows(tx, "Ad", [id]);
  const ad = await tx.ad.findFirst({ where: { id, sponsorId: target.sponsorId }, select: { status: true, title: true, submittedAt: true, endAt: true, imageFileId: true } });
  if (!ad) throw adNotFound();
  if (!nextAdStatus(ad.status, action)) failAd(adViolation("AD_INVALID_TRANSITION", "Aksi ini tidak berlaku untuk status iklan saat ini.", { status: ad.status, action }));
  return { ...ad, sponsorStatus: sponsor.status };
}

function assertSameVersion(locked: LockedReview, target: ReviewTarget, submittedAt: string): void {
  const same = locked.submittedAt !== null && locked.submittedAt.getTime() === Date.parse(submittedAt) && locked.imageFileId === target.imageFileId;
  if (!same) {
    failAd(adViolation("AD_REVIEW_STALE", "Iklan telah diajukan ulang sejak Anda membukanya. Muat ulang lalu tinjau lagi.", { submittedAt: locked.submittedAt?.toISOString() ?? null }));
  }
}

async function approveInTx(tx: Tx, id: string, target: ReviewTarget, submittedAt: string, ctx: ActionContext): Promise<void> {
  await lockKey(tx, bannerLockKey(target.imageFileId));
  const locked = await lockForReview(tx, id, target, "approve");
  assertSameVersion(locked, target, submittedAt);
  if (locked.sponsorStatus !== "APPROVED") failAd(adViolation("AD_INVALID_TRANSITION", "Sponsor tidak berstatus disetujui; iklan tidak dapat disetujui."));
  if (locked.endAt.getTime() <= ctx.now.getTime()) failAd(adViolation("AD_SCHEDULE_INVALID", "Jadwal tayang iklan sudah berakhir."));
  const publicImageKey = await publishBannerInTx(tx, target.imageFileId);
  const actor = requirePrincipal(ctx).userId;
  await tx.ad.updateMany({
    where: { id, status: "PENDING_REVIEW" },
    data: { status: "APPROVED", publicImageKey, reviewedById: actor, reviewedAt: ctx.now, reviewNote: null, updatedAt: ctx.now },
  });
  await notifySponsorMembers(tx, target.sponsorId, adApprovedNotification({ adId: id, title: locked.title }), ctx);
  await writeAudit(tx, { action: "ad.approve", entityType: "Ad", entityId: id, before: { status: locked.status }, after: { status: "APPROVED" } }, ctx);
}

/** POST /platform/ads/{id}/approve. Gagal di tengah -> salinan publik disamakan lagi dengan status. */
export async function approveAd(id: string, submittedAt: string, ctx: ActionContext): Promise<ReviewAdDto> {
  const target = await findTarget(id);
  try {
    await withTx((tx) => approveInTx(tx, id, target, submittedAt, ctx));
  } catch (error) {
    await syncBannerPublication(target.imageFileId);
    throw error;
  }
  return getPlatformAd(id, ctx.now);
}

interface RejectInput {
  readonly reason: string;
  /** Wajib untuk reject (CAS); takedown tidak memakai versi. */
  readonly submittedAt?: string;
}

async function rejectInTx(tx: Tx, id: string, target: ReviewTarget, input: RejectInput, ctx: ActionContext): Promise<AdStatus> {
  const takedown = input.submittedAt === undefined;
  const locked = await lockForReview(tx, id, target, takedown ? "takedown" : "reject");
  if (input.submittedAt !== undefined) assertSameVersion(locked, target, input.submittedAt);
  const actor = requirePrincipal(ctx).userId;
  await tx.ad.updateMany({
    where: { id, status: locked.status },
    data: { status: "REJECTED", publicImageKey: null, reviewNote: input.reason, reviewedById: actor, reviewedAt: ctx.now, updatedAt: ctx.now },
  });
  await notifySponsorMembers(tx, target.sponsorId, adRejectedNotification({ adId: id, title: locked.title, reason: input.reason, takedown }), ctx);
  const audit = { before: { status: locked.status }, after: { status: "REJECTED", reason: input.reason } };
  await writeAudit(tx, { action: takedown ? "ad.takedown" : "ad.reject", entityType: "Ad", entityId: id, ...audit }, ctx);
  return locked.status;
}

/** POST /platform/ads/{id}/reject (submittedAt wajib) & /takedown (tanpa versi). */
export async function rejectAd(id: string, input: RejectInput, ctx: ActionContext): Promise<ReviewAdDto> {
  const target = await findTarget(id);
  const previous = await withTx((tx) => rejectInTx(tx, id, target, input, ctx));
  if (previous === "APPROVED" || previous === "PAUSED") await syncBannerPublication(target.imageFileId);
  return getPlatformAd(id, ctx.now);
}
