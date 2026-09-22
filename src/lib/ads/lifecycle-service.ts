import type { AdStatus, Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { notifySuperAdmins } from "@/lib/notifications/notify";
import { adSubmittedNotification } from "@/lib/notifications/templates/sponsors";
import { lockSponsor, type LockedSponsor } from "@/lib/sponsors/ledger";
import { ownSponsorId } from "@/lib/sponsors/queries";
import { getAdSettings } from "@/lib/sponsors/settings-service";
import { lockRows, withTx } from "@/lib/tx";
import { assertSponsorApproved, assertSponsorWritable } from "./ad-content";
import { adNotFound, getOwnAd } from "./ad-queries";
import { nextAdStatus, scheduleViolation, type AdAction } from "./ad-rules";
import { syncBannerPublication } from "./banner-service";
import { adViolation, assertAdRule, failAd } from "./errors";
import type { AdDto } from "./response-schemas";

/**
 * Siklus iklan oleh sponsor: submit (DRAFT/REJECTED -> PENDING_REVIEW, CPC di-snapshot), withdraw
 * (PENDING_REVIEW -> DRAFT), pause (APPROVED -> PAUSED), resume (PAUSED -> APPROVED), archive (-> ARCHIVED,
 * terminal). submit & resume hanya sponsor APPROVED dan jadwal belum berakhir. Setiap transisi = CAS
 * `updateMany where { id, sponsorId, status }` di bawah kunci Sponsor -> Ad.
 */
export type OwnAdAction = Extract<AdAction, "submit" | "withdraw" | "pause" | "resume" | "archive">;

interface LockedAd {
  readonly status: AdStatus;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly imageFileId: string;
}

async function lockOwnAd(tx: Tx, sponsorId: string, id: string): Promise<LockedAd> {
  await lockRows(tx, "Ad", [id]);
  const ad = await tx.ad.findFirst({ where: { id, sponsorId }, select: { status: true, title: true, startAt: true, endAt: true, imageFileId: true } });
  if (!ad) throw adNotFound();
  return ad;
}

async function dataFor(tx: Tx, action: OwnAdAction, ad: LockedAd, locked: LockedSponsor, now: Date): Promise<Prisma.AdUncheckedUpdateManyInput> {
  if (action === "submit" || action === "resume") {
    assertSponsorApproved(locked.status);
    assertAdRule(scheduleViolation(ad, now, "submit"));
  }
  switch (action) {
    case "submit":
      return { submittedAt: now, cpcAmount: (await getAdSettings(tx)).defaultCpcAmount, reviewNote: null, reviewedAt: null, reviewedById: null };
    case "withdraw":
      return { submittedAt: null };
    case "archive":
      return { publicImageKey: null };
    default:
      return {};
  }
}

async function applyTransition(tx: Tx, sponsorId: string, id: string, action: OwnAdAction, ctx: ActionContext): Promise<LockedAd> {
  const locked = await lockSponsor(tx, sponsorId);
  assertSponsorWritable(locked.status);
  const ad = await lockOwnAd(tx, sponsorId, id);
  const next = nextAdStatus(ad.status, action);
  if (!next) failAd(adViolation("AD_INVALID_TRANSITION", "Aksi ini tidak berlaku untuk status iklan saat ini.", { status: ad.status, action }));
  const data = await dataFor(tx, action, ad, locked, ctx.now);
  const updated = await tx.ad.updateMany({ where: { id, sponsorId, status: ad.status }, data: { ...data, status: next, updatedAt: ctx.now } });
  if (updated.count !== 1) failAd(adViolation("AD_INVALID_TRANSITION", "Status iklan berubah bersamaan. Muat ulang lalu coba lagi."));
  if (action === "submit") {
    await notifySuperAdmins(tx, adSubmittedNotification({ adId: id, title: ad.title, companyName: locked.companyName }), ctx);
    await writeAudit(tx, { action: "ad.submit", entityType: "Ad", entityId: id, before: { status: ad.status }, after: { status: next, cpcAmount: data.cpcAmount } }, ctx);
  }
  return ad;
}

/** POST /sponsor/ads/{id}/{submit|withdraw|pause|resume|archive}. */
export async function transitionOwnAd(ctx: ActionContext, id: string, action: OwnAdAction): Promise<AdDto> {
  const sponsorId = ownSponsorId(ctx);
  const before = await withTx((tx) => applyTransition(tx, sponsorId, id, action, ctx));
  if (action === "archive" && (before.status === "APPROVED" || before.status === "PAUSED")) await syncBannerPublication(before.imageFileId);
  return getOwnAd(prisma, sponsorId, id, ctx.now);
}
