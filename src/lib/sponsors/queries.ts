import type { Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { prisma, type Db, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { toSkipTake } from "@/lib/http/pagination";
import { likeSearch } from "@/lib/http/like";
import { resolveSponsorScope } from "@/lib/tenant/scope";
import { LOW_BALANCE_THRESHOLD } from "./constants";
import { sponsorNotFound } from "./ledger";
import type { LedgerEntryDto, SponsorBalanceDto, SponsorDetailDto, SponsorDto, SponsorListItemDto } from "./response-schemas";
import { effectiveMinTopUp, summarizeBalance, type BalanceSummary } from "./rules";
import type { LedgerQuery, ListSponsorsQuery } from "./schemas";
import { getAdSettings } from "./settings-service";

/** Baca data sponsor (tanpa kunci). Lookup selalu findFirst({ id }) / cakupan sponsorId; tidak ada -> 404. */

const SPONSOR_SELECT = {
  id: true, companyName: true, contactName: true, contactEmail: true, contactPhone: true, address: true, status: true,
  statusReason: true, reviewedAt: true, balance: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.SponsorSelect;

type SponsorRow = Prisma.SponsorGetPayload<{ select: typeof SPONSOR_SELECT }>;

export const toSponsorDto = (row: SponsorRow): SponsorDto => ({
  ...row,
  reviewedAt: row.reviewedAt?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

export async function getSponsorDto(db: Db | Tx, sponsorId: string): Promise<SponsorDto> {
  const row = await db.sponsor.findFirst({ where: { id: sponsorId }, select: SPONSOR_SELECT });
  if (!row) throw sponsorNotFound();
  return toSponsorDto(row);
}

function listWhere(query: ListSponsorsQuery): Prisma.SponsorWhereInput {
  const q = likeSearch(query.q);
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(q ? { OR: [{ companyName: { contains: q } }, { contactEmail: { contains: q } }] } : {}),
  };
}

export async function listSponsors(query: ListSponsorsQuery): Promise<{ data: SponsorListItemDto[]; meta: PageMeta }> {
  const where = listWhere(query);
  const [total, rows] = await Promise.all([
    prisma.sponsor.count({ where }),
    prisma.sponsor.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      ...toSkipTake(query),
      select: {
        id: true, companyName: true, contactEmail: true, status: true, balance: true, createdAt: true,
        _count: { select: { topUpRequests: { where: { status: "PENDING" } }, ads: { where: { status: "PENDING_REVIEW" } } } },
      },
    }),
  ]);
  const data = rows.map((row) => ({
    id: row.id, companyName: row.companyName, contactEmail: row.contactEmail, status: row.status, balance: row.balance,
    pendingTopUps: row._count.topUpRequests, pendingAdReviews: row._count.ads, createdAt: row.createdAt.toISOString(),
  }));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}

/** Agregat ledger per tipe (index [sponsorId, type, createdAt]). */
async function balanceSummaryOf(db: Db | Tx, sponsorId: string, balance: number, defaultCpc: number): Promise<BalanceSummary> {
  const groups = await db.sponsorLedgerEntry.groupBy({ by: ["type"], where: { sponsorId }, _sum: { amount: true } });
  const sumOf = (type: string): number => groups.find((g) => g.type === type)?._sum.amount ?? 0;
  return summarizeBalance({ balance, totalTopUp: sumOf("TOPUP"), totalSpent: -sumOf("CLICK_CHARGE"), netAdjustment: sumOf("ADJUSTMENT"), defaultCpc });
}

const pendingTopUpsOf = (db: Db | Tx, sponsorId: string): Promise<number> =>
  db.topUpRequest.count({ where: { sponsorId, status: "PENDING" } });

export async function getSponsorDetail(sponsorId: string): Promise<SponsorDetailDto> {
  const sponsor = await getSponsorDto(prisma, sponsorId);
  const [settings, members, pendingTopUps] = await Promise.all([
    getAdSettings(),
    prisma.user.findMany({
      where: { sponsorId, role: "SPONSOR" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, isActive: true, mustChangePassword: true },
    }),
    pendingTopUpsOf(prisma, sponsorId),
  ]);
  const balanceSummary = await balanceSummaryOf(prisma, sponsorId, sponsor.balance, settings.defaultCpcAmount);
  return { ...sponsor, members, balanceSummary, pendingTopUps };
}

/** Kartu saldo sponsor: "sisa … dari total top-up" + rekening tujuan & batas minimal top-up. */
export async function getSponsorBalance(sponsorId: string): Promise<SponsorBalanceDto> {
  const sponsor = await getSponsorDto(prisma, sponsorId);
  const [settings, pendingTopUps] = await Promise.all([getAdSettings(), pendingTopUpsOf(prisma, sponsorId)]);
  const summary = await balanceSummaryOf(prisma, sponsorId, sponsor.balance, settings.defaultCpcAmount);
  const { topUpBankName, topUpAccountNumber, topUpAccountHolder } = settings;
  const topUpAccount = topUpBankName && topUpAccountNumber && topUpAccountHolder
    ? { bankName: topUpBankName, accountNumber: topUpAccountNumber, accountHolder: topUpAccountHolder }
    : null;
  return {
    ...summary,
    lowBalanceThreshold: LOW_BALANCE_THRESHOLD,
    defaultCpcAmount: settings.defaultCpcAmount,
    minTopUpAmount: effectiveMinTopUp(settings.minTopUpAmount),
    pendingTopUps,
    topUpAccount,
  };
}

/** Ledger sponsor terbaru dulu (seq menurun). */
export async function listLedger(sponsorId: string, query: LedgerQuery): Promise<{ data: LedgerEntryDto[]; meta: PageMeta }> {
  const where: Prisma.SponsorLedgerEntryWhereInput = { sponsorId, ...(query.type ? { type: query.type } : {}) };
  const [total, rows] = await Promise.all([
    prisma.sponsorLedgerEntry.count({ where }),
    prisma.sponsorLedgerEntry.findMany({
      where,
      orderBy: { seq: "desc" },
      ...toSkipTake(query),
      select: {
        id: true, seq: true, type: true, amount: true, balanceAfter: true, note: true, topUpRequestId: true, createdAt: true,
        adClick: { select: { adId: true } },
      },
    }),
  ]);
  const data = rows.map(({ adClick, createdAt, ...row }) => ({ ...row, adId: adClick?.adId ?? null, createdAt: createdAt.toISOString() }));
  return { data, meta: pageMeta(total, query.page, query.limit) };
}

export async function assertSponsorExists(sponsorId: string): Promise<void> {
  const row = await prisma.sponsor.findFirst({ where: { id: sponsorId }, select: { id: true } });
  if (!row) throw sponsorNotFound();
}

/** Sponsor pemanggil (SPONSOR selalu miliknya sendiri; id tidak pernah dari request). */
export const ownSponsorId = (ctx: ActionContext): string => resolveSponsorScope(requirePrincipal(ctx)).sponsorId;

export const getOwnSponsor = (ctx: ActionContext): Promise<SponsorDto> => getSponsorDto(prisma, ownSponsorId(ctx));

/** Ledger sponsor mana pun untuk super admin (sponsor tidak ada -> 404). */
export async function listPlatformLedger(sponsorId: string, query: LedgerQuery): Promise<{ data: LedgerEntryDto[]; meta: PageMeta }> {
  await assertSponsorExists(sponsorId);
  return listLedger(sponsorId, query);
}
