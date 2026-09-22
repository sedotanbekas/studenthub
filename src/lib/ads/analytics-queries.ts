import { Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { ENUM_LABELS } from "@/lib/platform/enum-labels";
import { assertSponsorExists } from "@/lib/sponsors/queries";
import { resolveSponsorScope } from "@/lib/tenant/scope";
import { fromDbDate, toDbDate, wibDate } from "@/lib/time/zone";
import { adNotFound, publicImageUrl } from "./ad-queries";
import { deriveDisplayStatus } from "./ad-rules";
import { changePct, ctr, fillDailySeries, resolvePeriod, shareBreakdown, sortAdRows, type DailyRow, type Period } from "./analytics-rules";
import { PER_AD_TABLE_MAX_ADS } from "./constants";
import { failAd } from "./errors";
import type { AdPerformanceDto } from "./response-schemas";
import type { AdTableQuery, AnalyticsQuery, BreakdownQuery } from "./schemas";

/**
 * Analitik sponsor (hari WIB). KPI, deret harian & tabel per iklan dari rollup AdDailyStat; klik unik =
 * COUNT(DISTINCT userId) atas AdClick (tidak bisa dijumlah dari rollup). Sponsor selalu miliknya sendiri;
 * super admin wajib sponsorId. adId milik sponsor lain -> 404.
 */
export interface AnalyticsScope {
  readonly sponsorId: string;
  readonly adId: string | null;
  readonly period: Period;
}

export async function resolveAnalyticsScope(ctx: ActionContext, query: AnalyticsQuery): Promise<AnalyticsScope> {
  const principal = requirePrincipal(ctx);
  const { sponsorId } = resolveSponsorScope(principal, query.sponsorId);
  if (principal.role === "SUPER_ADMIN") await assertSponsorExists(sponsorId);
  const resolved = resolvePeriod(query, wibDate(ctx.now));
  if (!resolved.ok) failAd(resolved.violation);
  if (query.adId) {
    const ad = await prisma.ad.findFirst({ where: { id: query.adId, sponsorId }, select: { id: true } });
    if (!ad) throw adNotFound();
  }
  return { sponsorId, adId: query.adId ?? null, period: resolved.period };
}

const adFilter = (adId: string | null): Prisma.Sql => (adId ? Prisma.sql`AND \`adId\` = ${adId}` : Prisma.empty);

async function totals(scope: AnalyticsScope, from: string, to: string) {
  const where = { sponsorId: scope.sponsorId, date: { gte: toDbDate(from), lte: toDbDate(to) }, ...(scope.adId ? { adId: scope.adId } : {}) };
  const agg = await prisma.adDailyStat.aggregate({ where, _sum: { impressions: true, clicks: true, chargedClicks: true, spend: true } });
  const rows = await prisma.$queryRaw<Array<{ n: bigint | number }>>`
    SELECT COUNT(DISTINCT \`userId\`) AS n FROM \`AdClick\`
    WHERE \`sponsorId\` = ${scope.sponsorId} AND \`date\` BETWEEN ${toDbDate(from)} AND ${toDbDate(to)} ${adFilter(scope.adId)}`;
  const s = agg._sum;
  return {
    impressions: s.impressions ?? 0, clicks: s.clicks ?? 0, chargedClicks: s.chargedClicks ?? 0, spend: s.spend ?? 0,
    uniqueClicks: Number(rows[0]?.n ?? 0),
  };
}

const kpi = <T extends number | null>(value: T, previous: T) => ({ value, previous, changePct: changePct(value, previous) });

export async function getSummary(scope: AnalyticsScope) {
  const { period } = scope;
  const [cur, prev] = await Promise.all([totals(scope, period.from, period.to), totals(scope, period.prevFrom, period.prevTo)]);
  return {
    period,
    kpis: {
      impressions: kpi(cur.impressions, prev.impressions),
      clicks: kpi(cur.clicks, prev.clicks),
      uniqueClicks: kpi(cur.uniqueClicks, prev.uniqueClicks),
      ctr: kpi(ctr(cur.clicks, cur.impressions), ctr(prev.clicks, prev.impressions)),
      spend: kpi(cur.spend, prev.spend),
      chargedClicks: kpi(cur.chargedClicks, prev.chargedClicks),
    },
  };
}

export async function getDailySeries(scope: AnalyticsScope): Promise<{ period: Period; days: DailyRow[] }> {
  const { period } = scope;
  const range = { gte: toDbDate(period.from), lte: toDbDate(period.to) };
  const [stats, uniques] = await Promise.all([
    prisma.adDailyStat.groupBy({
      by: ["date"],
      where: { sponsorId: scope.sponsorId, date: range, ...(scope.adId ? { adId: scope.adId } : {}) },
      _sum: { impressions: true, clicks: true, chargedClicks: true, spend: true },
    }),
    prisma.$queryRaw<Array<{ date: Date; n: bigint | number }>>`
      SELECT \`date\`, COUNT(DISTINCT \`userId\`) AS n FROM \`AdClick\`
      WHERE \`sponsorId\` = ${scope.sponsorId} AND \`date\` BETWEEN ${range.gte} AND ${range.lte} ${adFilter(scope.adId)}
      GROUP BY \`date\``,
  ]);
  const uniqueByDate = new Map(uniques.map((u) => [fromDbDate(u.date), Number(u.n)]));
  const rows = stats.map((s) => {
    const date = fromDbDate(s.date);
    return {
      date, impressions: s._sum.impressions ?? 0, clicks: s._sum.clicks ?? 0, uniqueClicks: uniqueByDate.get(date) ?? 0,
      chargedClicks: s._sum.chargedClicks ?? 0, spend: s._sum.spend ?? 0,
    };
  });
  return { period, days: fillDailySeries(rows, period.from, period.to) };
}

async function provinceNames(codes: readonly string[]): Promise<Map<string, string>> {
  if (codes.length === 0) return new Map();
  const rows = await prisma.province.findMany({ where: { code: { in: [...codes] } }, select: { code: true, name: true } });
  return new Map(rows.map((r) => [r.code, r.name]));
}

export async function getBreakdown(scope: AnalyticsScope, dimension: BreakdownQuery["dimension"]) {
  const { period } = scope;
  const where = { sponsorId: scope.sponsorId, date: { gte: toDbDate(period.from), lte: toDbDate(period.to) }, ...(scope.adId ? { adId: scope.adId } : {}) };
  const grouped = dimension === "device"
    ? (await prisma.adClick.groupBy({ by: ["deviceType"], where, _count: { _all: true } })).map((g) => ({ key: g.deviceType as string, clicks: g._count._all }))
    : (await prisma.adClick.groupBy({ by: ["provinceCode"], where, _count: { _all: true } })).map((g) => ({ key: g.provinceCode, clicks: g._count._all }));
  const names = dimension === "province" ? await provinceNames(grouped.map((g) => g.key)) : new Map<string, string>();
  const deviceLabels: Record<string, string> = ENUM_LABELS.DeviceType;
  const labelled = grouped
    .sort((a, b) => b.clicks - a.clicks || a.key.localeCompare(b.key))
    .map((g) => ({ ...g, label: (dimension === "device" ? deviceLabels[g.key] : names.get(g.key)) ?? g.key }));
  return { period, dimension, items: shareBreakdown(labelled) };
}

async function perAdStats(scope: AnalyticsScope, adIds: readonly string[]) {
  const { period } = scope;
  const range = { gte: toDbDate(period.from), lte: toDbDate(period.to) };
  const [stats, uniques] = await Promise.all([
    prisma.adDailyStat.groupBy({ by: ["adId"], where: { sponsorId: scope.sponsorId, date: range, adId: { in: [...adIds] } }, _sum: { impressions: true, clicks: true, spend: true } }),
    prisma.$queryRaw<Array<{ adId: string; n: bigint | number }>>`
      SELECT \`adId\`, COUNT(DISTINCT \`userId\`) AS n FROM \`AdClick\`
      WHERE \`sponsorId\` = ${scope.sponsorId} AND \`date\` BETWEEN ${range.gte} AND ${range.lte} GROUP BY \`adId\``,
  ]);
  return { stats: new Map(stats.map((s) => [s.adId, s._sum])), uniques: new Map(uniques.map((u) => [u.adId, Number(u.n)])) };
}

/** Tabel per iklan (termasuk baris nol; iklan arsip hanya bila punya statistik dalam rentang), diurutkan lalu dipaginasi. */
export async function getAdPerformance(scope: AnalyticsScope, query: AdTableQuery, now: Date): Promise<{ data: AdPerformanceDto[]; meta: PageMeta }> {
  const [sponsor, ads] = await Promise.all([
    prisma.sponsor.findFirst({ where: { id: scope.sponsorId }, select: { status: true, balance: true } }),
    prisma.ad.findMany({
      where: { sponsorId: scope.sponsorId, ...(scope.adId ? { id: scope.adId } : {}) },
      orderBy: { createdAt: "desc" },
      take: PER_AD_TABLE_MAX_ADS,
      select: { id: true, title: true, status: true, startAt: true, endAt: true, cpcAmount: true, publicImageKey: true },
    }),
  ]);
  const state = sponsor ?? { status: "SUSPENDED" as const, balance: 0 };
  const { stats, uniques } = await perAdStats(scope, ads.map((a) => a.id));
  const rows = ads.flatMap((ad) => {
    const s = stats.get(ad.id);
    if (ad.status === "ARCHIVED" && !s) return [];
    const impressions = s?.impressions ?? 0;
    const clicks = s?.clicks ?? 0;
    const displayStatus = deriveDisplayStatus(ad, state, now);
    return [{
      adId: ad.id, title: ad.title, imageUrl: publicImageUrl(ad.status, ad.publicImageKey), status: ad.status, displayStatus, isActive: displayStatus === "LIVE",
      startAt: ad.startAt.toISOString(), endAt: ad.endAt.toISOString(), impressions, clicks, uniqueClicks: uniques.get(ad.id) ?? 0,
      ctr: ctr(clicks, impressions), spend: s?.spend ?? 0,
    }];
  });
  const sorted = sortAdRows(rows, query.sort);
  const start = (query.page - 1) * query.limit;
  return { data: sorted.slice(start, start + query.limit), meta: pageMeta(sorted.length, query.page, query.limit) };
}

// ----------------------------------------------------------------------------- titik masuk route

export const analyticsSummary = async (ctx: ActionContext, query: AnalyticsQuery) => getSummary(await resolveAnalyticsScope(ctx, query));
export const analyticsSeries = async (ctx: ActionContext, query: AnalyticsQuery) => getDailySeries(await resolveAnalyticsScope(ctx, query));
export const analyticsBreakdown = async (ctx: ActionContext, query: BreakdownQuery) =>
  getBreakdown(await resolveAnalyticsScope(ctx, query), query.dimension);
export const analyticsPerAd = async (ctx: ActionContext, query: AdTableQuery) =>
  getAdPerformance(await resolveAnalyticsScope(ctx, query), query, ctx.now);
