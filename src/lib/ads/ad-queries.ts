import type { AdStatus, Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Db, type Tx } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { notFound } from "@/lib/http/errors";
import { likeSearch } from "@/lib/http/like";
import { toSkipTake } from "@/lib/http/pagination";
import { ownSponsorId } from "@/lib/sponsors/queries";
import { publicUrlFor } from "@/lib/storage/keys";
import { deriveDisplayStatus } from "./ad-rules";
import { linkHostOf } from "./link-rules";
import type { AdDto, ReviewAdDto } from "./response-schemas";
import type { OwnAdsQuery, PlatformAdsQuery } from "./schemas";

/**
 * Baca iklan. Sponsor: selalu `{ id, sponsorId }` (iklan sponsor lain -> 404 AD_NOT_FOUND). Super admin:
 * semua iklan. URL publik banner hanya diberikan selama iklan APPROVED/PAUSED (salinan /media ada).
 */
export const adNotFound = () => notFound("Iklan tidak ditemukan.", "AD_NOT_FOUND");

export const AD_SELECT = {
  id: true, sponsorId: true, title: true, imageFileId: true, publicImageKey: true, linkType: true, targetUrl: true, startAt: true,
  endAt: true, status: true, targetScope: true, cpcAmount: true, submittedAt: true, reviewNote: true, reviewedAt: true,
  createdAt: true, updatedAt: true,
  targets: {
    select: { provinceCode: true, cityCode: true, schoolId: true, province: { select: { name: true } }, city: { select: { name: true } }, school: { select: { name: true } } },
    orderBy: { id: "asc" },
  },
  sponsor: { select: { id: true, companyName: true, status: true, balance: true } },
} as const satisfies Prisma.AdSelect;

export type AdRow = Prisma.AdGetPayload<{ select: typeof AD_SELECT }>;

const PUBLISHED: ReadonlySet<AdStatus> = new Set<AdStatus>(["APPROVED", "PAUSED"]);

export function publicImageUrl(status: AdStatus, key: string | null): string | null {
  if (!key || !PUBLISHED.has(status)) return null;
  return publicUrlFor(key, getEnv().PUBLIC_MEDIA_BASE_URL);
}

const targetLabel = (t: AdRow["targets"][number]): string => t.province?.name ?? t.city?.name ?? t.school?.name ?? "-";

export function toAdDto(row: AdRow, now: Date): AdDto {
  const displayStatus = deriveDisplayStatus(row, row.sponsor, now);
  return {
    id: row.id, sponsorId: row.sponsorId, title: row.title, imageFileId: row.imageFileId, imageUrl: publicImageUrl(row.status, row.publicImageKey),
    linkType: row.linkType, targetUrl: row.targetUrl, startAt: row.startAt.toISOString(), endAt: row.endAt.toISOString(), status: row.status,
    displayStatus, isActive: displayStatus === "LIVE", targetScope: row.targetScope,
    targets: row.targets.map((t) => ({ provinceCode: t.provinceCode, cityCode: t.cityCode, schoolId: t.schoolId, label: targetLabel(t) })),
    cpcAmount: row.cpcAmount, submittedAt: row.submittedAt?.toISOString() ?? null, reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export function toReviewAdDto(row: AdRow, now: Date): ReviewAdDto {
  const host = linkHostOf(row.targetUrl);
  return { ...toAdDto(row, now), sponsor: row.sponsor, urlHost: host?.host ?? null, isPunycodeHost: host?.isPunycodeHost ?? false };
}

export async function getOwnAd(db: Db | Tx, sponsorId: string, id: string, now: Date): Promise<AdDto> {
  const row = await db.ad.findFirst({ where: { id, sponsorId }, select: AD_SELECT });
  if (!row) throw adNotFound();
  return toAdDto(row, now);
}

export async function listOwnAds(sponsorId: string, query: OwnAdsQuery, now: Date): Promise<{ data: AdDto[]; meta: PageMeta }> {
  const q = likeSearch(query.q);
  const where: Prisma.AdWhereInput = { sponsorId, ...(query.status ? { status: query.status } : {}), ...(q ? { title: { contains: q } } : {}) };
  const [total, rows] = await Promise.all([
    prisma.ad.count({ where }),
    prisma.ad.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], ...toSkipTake(query), select: AD_SELECT }),
  ]);
  return { data: rows.map((row) => toAdDto(row, now)), meta: pageMeta(total, query.page, query.limit) };
}

/** Antrean review: PENDING_REVIEW submittedAt terlama dulu; status lain terbaru diperbarui dulu. */
export async function listPlatformAds(query: PlatformAdsQuery, now: Date): Promise<{ data: ReviewAdDto[]; meta: PageMeta }> {
  const q = likeSearch(query.q);
  const where: Prisma.AdWhereInput = {
    status: query.status,
    ...(query.sponsorId ? { sponsorId: query.sponsorId } : {}),
    ...(q ? { title: { contains: q } } : {}),
  };
  const orderBy: Prisma.AdOrderByWithRelationInput[] =
    query.status === "PENDING_REVIEW" ? [{ submittedAt: "asc" }, { id: "asc" }] : [{ updatedAt: "desc" }, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.ad.count({ where }),
    prisma.ad.findMany({ where, orderBy, ...toSkipTake(query), select: AD_SELECT }),
  ]);
  return { data: rows.map((row) => toReviewAdDto(row, now)), meta: pageMeta(total, query.page, query.limit) };
}

export async function getPlatformAd(id: string, now: Date): Promise<ReviewAdDto> {
  const row = await prisma.ad.findFirst({ where: { id }, select: AD_SELECT });
  if (!row) throw adNotFound();
  return toReviewAdDto(row, now);
}

// ----------------------------------------------------------------------------- titik masuk route sponsor

export const findOwnAd = (ctx: ActionContext, id: string): Promise<AdDto> => getOwnAd(prisma, ownSponsorId(ctx), id, ctx.now);
export const listOwnAdsFor = (ctx: ActionContext, query: OwnAdsQuery) => listOwnAds(ownSponsorId(ctx), query, ctx.now);
