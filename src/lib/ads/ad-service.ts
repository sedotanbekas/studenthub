import type { AdStatus } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { conflict } from "@/lib/http/errors";
import { notifySuperAdmins } from "@/lib/notifications/notify";
import { adSubmittedNotification } from "@/lib/notifications/templates/sponsors";
import { lockSponsor, type LockedSponsor } from "@/lib/sponsors/ledger";
import { ownSponsorId } from "@/lib/sponsors/queries";
import { getAdSettings, type AdSettings } from "@/lib/sponsors/settings-service";
import { lockRows, withTx } from "@/lib/tx";
import { assertSponsorApproved, assertSponsorWritable, checkLink, prepareContent, rowKeys, type AdContent } from "./ad-content";
import { adNotFound, getOwnAd } from "./ad-queries";
import { editOutcome, requiresReReview, scheduleViolation, targetKeysOf, type TargetRow } from "./ad-rules";
import { claimOwnBanner, releaseBannerIfUnused, syncBannerPublication } from "./banner-service";
import { MAX_NON_ARCHIVED_ADS_PER_SPONSOR } from "./constants";
import { adViolation, assertAdRule, failAd } from "./errors";
import type { AdDto } from "./response-schemas";
import type { CreateAdInput, UpdateAdInput } from "./schemas";

/**
 * Buat / ubah / hapus iklan milik sponsor. Urutan kunci: Sponsor -> Ad -> StoredFile (banner) -> AdTarget;
 * Notification & AuditLog terakhir. Ubah konten iklan aktif (APPROVED/PAUSED: gambar, tautan, tipe tautan,
 * cakupan/target) -> PENDING_REVIEW dengan CPC di-snapshot ulang; judul/jadwal tidak memicu review.
 */
const PUBLISHED: ReadonlySet<AdStatus> = new Set<AdStatus>(["APPROVED", "PAUSED"]);

async function writeTargets(tx: Tx, adId: string, rows: readonly TargetRow[], now: Date): Promise<void> {
  await tx.adTarget.deleteMany({ where: { adId } });
  if (rows.length > 0) await tx.adTarget.createMany({ data: rows.map((row) => ({ adId, ...row, createdAt: now })) });
}

const contentData = (c: AdContent) => ({
  title: c.title, imageFileId: c.imageFileId, linkType: c.linkType, targetUrl: c.targetUrl, startAt: c.startAt, endAt: c.endAt, targetScope: c.targetScope,
});

/** POST /sponsor/ads: DRAFT dengan perkiraan CPC (default saat ini). PENDING & APPROVED boleh. */
export async function createAd(ctx: ActionContext, input: CreateAdInput): Promise<AdDto> {
  const sponsorId = ownSponsorId(ctx);
  const settings = await getAdSettings();
  const href = checkLink(input.targetUrl, input.linkType, settings.deepLinkSchemes);
  const content = await prepareContent(prisma, input, href, ctx.now);
  const id = await withTx(async (tx) => {
    assertSponsorWritable((await lockSponsor(tx, sponsorId)).status);
    const count = await tx.ad.count({ where: { sponsorId, status: { not: "ARCHIVED" } } });
    if (count >= MAX_NON_ARCHIVED_ADS_PER_SPONSOR) {
      failAd(adViolation("AD_LIMIT_REACHED", `Maksimal ${MAX_NON_ARCHIVED_ADS_PER_SPONSOR} iklan belum diarsipkan per sponsor.`));
    }
    await claimOwnBanner(tx, content.imageFileId, sponsorId, ctx.now);
    const ad = await tx.ad.create({
      data: { sponsorId, ...contentData(content), status: "DRAFT", cpcAmount: settings.defaultCpcAmount, createdAt: ctx.now, updatedAt: ctx.now },
      select: { id: true },
    });
    await writeTargets(tx, ad.id, content.rows, ctx.now);
    return ad.id;
  });
  return getOwnAd(prisma, sponsorId, id, ctx.now);
}

const EDITABLE_SELECT = {
  id: true, status: true, updatedAt: true, title: true, imageFileId: true, linkType: true, targetUrl: true, startAt: true, endAt: true,
  targetScope: true, targets: { select: { provinceCode: true, cityCode: true, schoolId: true } },
} as const;

type EditableAd = NonNullable<Awaited<ReturnType<typeof loadEditable>>>;

function loadEditable(db: Tx, sponsorId: string, id: string) {
  return db.ad.findFirst({ where: { id, sponsorId }, select: EDITABLE_SELECT });
}

/** Gabungkan patch dengan nilai tersimpan; tautan hanya divalidasi ulang bila tautan/tipe diubah. */
async function mergeContent(tx: Tx, current: EditableAd, input: UpdateAdInput, settings: AdSettings, now: Date): Promise<AdContent> {
  const linkType = input.linkType ?? current.linkType;
  const touchedLink = input.targetUrl !== undefined || input.linkType !== undefined;
  const href = touchedLink ? checkLink(input.targetUrl ?? current.targetUrl, linkType, settings.deepLinkSchemes) : current.targetUrl;
  const scope = input.targetScope ?? current.targetScope;
  const targets = input.targets ?? (input.targetScope !== undefined ? {} : targetInputOf(current));
  const merged = {
    title: input.title ?? current.title, imageFileId: input.imageFileId ?? current.imageFileId, linkType, targetUrl: href,
    startAt: input.startAt ?? current.startAt, endAt: input.endAt ?? current.endAt, targetScope: scope, targets,
  };
  return prepareContent(tx, merged, href, now);
}

function targetInputOf(ad: EditableAd) {
  const pick = (key: "provinceCode" | "cityCode" | "schoolId") => ad.targets.flatMap((t) => (t[key] ? [t[key]] : []));
  return { provinceCodes: pick("provinceCode"), cityCodes: pick("cityCode"), schoolIds: pick("schoolId") };
}

interface UpdateOutcome {
  readonly reReview: boolean;
  readonly unpublishFileIds: readonly string[];
}

function assertFresh(ad: EditableAd, expectedUpdatedAt: string | undefined): void {
  if (expectedUpdatedAt !== undefined && ad.updatedAt.getTime() !== Date.parse(expectedUpdatedAt)) {
    throw conflict("STATE_CONFLICT", "Iklan sudah diubah pihak lain. Muat ulang lalu coba lagi.", { updatedAt: ad.updatedAt.toISOString() });
  }
}

function reviewPlan(ad: EditableAd, content: AdContent, locked: LockedSponsor, now: Date): boolean {
  const before = { imageFileId: ad.imageFileId, targetUrl: ad.targetUrl, linkType: ad.linkType, targetScope: ad.targetScope, targetKeys: targetKeysOf(ad.targets) };
  const after = { imageFileId: content.imageFileId, targetUrl: content.targetUrl, linkType: content.linkType, targetScope: content.targetScope, targetKeys: rowKeys(content.rows) };
  const outcome = editOutcome(ad.status, requiresReReview(before, after));
  if (outcome === "LOCKED_PENDING") failAd(adViolation("AD_EDIT_WHILE_PENDING", "Iklan sedang ditinjau; tarik pengajuan dulu untuk mengubahnya."));
  if (outcome === "LOCKED") failAd(adViolation("AD_INVALID_TRANSITION", "Iklan yang diarsipkan tidak dapat diubah."));
  if (outcome !== "REREVIEW") return false;
  assertSponsorApproved(locked.status);
  assertAdRule(scheduleViolation(content, now, "submit"));
  return true;
}

async function applyUpdate(tx: Tx, sponsorId: string, id: string, input: UpdateAdInput, ctx: ActionContext): Promise<UpdateOutcome> {
  const locked = await lockSponsor(tx, sponsorId);
  assertSponsorWritable(locked.status);
  await lockRows(tx, "Ad", [id]);
  const ad = await loadEditable(tx, sponsorId, id);
  if (!ad) throw adNotFound();
  assertFresh(ad, input.expectedUpdatedAt);
  const settings = await getAdSettings(tx);
  const content = await mergeContent(tx, ad, input, settings, ctx.now);
  const reReview = reviewPlan(ad, content, locked, ctx.now);
  const imageChanged = content.imageFileId !== ad.imageFileId;
  if (imageChanged) await claimOwnBanner(tx, content.imageFileId, sponsorId, ctx.now);
  const review = reReview
    ? { status: "PENDING_REVIEW" as const, submittedAt: ctx.now, cpcAmount: settings.defaultCpcAmount, publicImageKey: null, reviewNote: null, reviewedAt: null, reviewedById: null }
    : ad.status === "DRAFT" ? { cpcAmount: settings.defaultCpcAmount } : {};
  await tx.ad.update({ where: { id }, data: { ...contentData(content), ...review, updatedAt: ctx.now } });
  await writeTargets(tx, id, content.rows, ctx.now);
  if (imageChanged) await releaseBannerIfUnused(tx, ad.imageFileId);
  if (reReview) await announceResubmission(tx, { id, title: content.title, companyName: locked.companyName }, ctx);
  const unpublish = PUBLISHED.has(ad.status) && (reReview || imageChanged) ? [ad.imageFileId] : [];
  return { reReview, unpublishFileIds: unpublish };
}

async function announceResubmission(tx: Tx, ad: { id: string; title: string; companyName: string }, ctx: ActionContext): Promise<void> {
  await notifySuperAdmins(tx, adSubmittedNotification({ adId: ad.id, title: ad.title, companyName: ad.companyName }), ctx);
  await writeAudit(tx, { action: "ad.resubmit", entityType: "Ad", entityId: ad.id, after: { status: "PENDING_REVIEW", reason: "content_edit" } }, ctx);
}

/** PATCH /sponsor/ads/{id}. */
export async function updateAd(ctx: ActionContext, id: string, input: UpdateAdInput): Promise<{ ad: AdDto; reReviewTriggered: boolean }> {
  const sponsorId = ownSponsorId(ctx);
  const outcome = await withTx((tx) => applyUpdate(tx, sponsorId, id, input, ctx));
  for (const fileId of outcome.unpublishFileIds) await syncBannerPublication(fileId);
  return { ad: await getOwnAd(prisma, sponsorId, id, ctx.now), reReviewTriggered: outcome.reReview };
}

/** DELETE /sponsor/ads/{id}: hanya DRAFT yang belum pernah punya klik/statistik; selain itu arsipkan. */
export async function deleteDraftAd(ctx: ActionContext, id: string): Promise<{ id: string }> {
  const sponsorId = ownSponsorId(ctx);
  await withTx(async (tx) => {
    assertSponsorWritable((await lockSponsor(tx, sponsorId)).status);
    await lockRows(tx, "Ad", [id]);
    const ad = await tx.ad.findFirst({ where: { id, sponsorId }, select: { status: true, imageFileId: true, _count: { select: { clicks: true, dailyStats: true } } } });
    if (!ad) throw adNotFound();
    if (ad.status !== "DRAFT" || ad._count.clicks > 0 || ad._count.dailyStats > 0) {
      failAd(adViolation("AD_NOT_DELETABLE", "Hanya draf yang belum pernah tayang yang dapat dihapus; arsipkan iklan ini.", { status: ad.status }));
    }
    await tx.ad.delete({ where: { id } });
    await releaseBannerIfUnused(tx, ad.imageFileId);
  });
  return { id };
}
