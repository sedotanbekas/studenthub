import type { Prisma } from "@prisma/client";
import { prisma, type Db, type Tx } from "@/lib/db";
import { pageMeta, type PageMeta } from "@/lib/http/envelope";
import { notFound } from "@/lib/http/errors";
import { toSkipTake } from "@/lib/http/pagination";
import { fromDbDate } from "@/lib/time/zone";
import type { PlatformTopUpDto, TopUpDto } from "./response-schemas";
import type { OwnTopUpsQuery, PlatformTopUpsQuery } from "./schemas";

/** Baca top-up: sponsor hanya miliknya (findFirst { id, sponsorId } -> 404), super admin semua + penanda bukti ganda. */

export const topUpNotFound = () => notFound("Pengajuan top-up tidak ditemukan.", "TOPUP_NOT_FOUND");

const TOPUP_SELECT = {
  id: true, sponsorId: true, amount: true, transferDate: true, senderName: true, senderBank: true, note: true, status: true,
  reviewNote: true, reviewedAt: true, proofFileId: true, createdAt: true,
} as const satisfies Prisma.TopUpRequestSelect;

const PLATFORM_SELECT = {
  ...TOPUP_SELECT,
  sponsor: { select: { id: true, companyName: true, status: true, balance: true } },
  proofFile: { select: { sha256: true } },
} as const satisfies Prisma.TopUpRequestSelect;

type TopUpRow = Prisma.TopUpRequestGetPayload<{ select: typeof TOPUP_SELECT }>;
type PlatformRow = Prisma.TopUpRequestGetPayload<{ select: typeof PLATFORM_SELECT }>;

export const toTopUpDto = (row: TopUpRow): TopUpDto => ({
  id: row.id, sponsorId: row.sponsorId, amount: row.amount, transferDate: fromDbDate(row.transferDate), senderName: row.senderName,
  senderBank: row.senderBank, note: row.note, status: row.status, reviewNote: row.reviewNote, reviewedAt: row.reviewedAt?.toISOString() ?? null,
  proofFileId: row.proofFileId, createdAt: row.createdAt.toISOString(),
});

/** Top-up lain (sponsor mana pun) yang buktinya identik byte-per-byte setelah re-encode (sha256, ber-index). */
async function duplicatesOf(db: Db | Tx, rows: readonly PlatformRow[]): Promise<Map<string, string[]>> {
  const hashes = [...new Set(rows.map((r) => r.proofFile.sha256))];
  if (hashes.length === 0) return new Map();
  const matches = await db.topUpRequest.findMany({
    where: { proofFile: { sha256: { in: hashes }, kind: "TOPUP_PROOF" } },
    select: { id: true, proofFile: { select: { sha256: true } } },
    take: 500,
  });
  return new Map(rows.map((r) => [r.id, matches.filter((m) => m.proofFile.sha256 === r.proofFile.sha256 && m.id !== r.id).map((m) => m.id)]));
}

function toPlatformDtos(rows: readonly PlatformRow[], dupes: Map<string, string[]>): PlatformTopUpDto[] {
  return rows.map(({ sponsor, proofFile: _proof, ...row }) => ({ ...toTopUpDto(row), sponsor, duplicateProofOf: dupes.get(row.id) ?? [] }));
}

export async function listOwnTopUps(sponsorId: string, query: OwnTopUpsQuery): Promise<{ data: TopUpDto[]; meta: PageMeta }> {
  const where: Prisma.TopUpRequestWhereInput = { sponsorId, ...(query.status ? { status: query.status } : {}) };
  const [total, rows] = await Promise.all([
    prisma.topUpRequest.count({ where }),
    prisma.topUpRequest.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], ...toSkipTake(query), select: TOPUP_SELECT }),
  ]);
  return { data: rows.map(toTopUpDto), meta: pageMeta(total, query.page, query.limit) };
}

export async function getOwnTopUp(db: Db | Tx, sponsorId: string, id: string): Promise<TopUpDto> {
  const row = await db.topUpRequest.findFirst({ where: { id, sponsorId }, select: TOPUP_SELECT });
  if (!row) throw topUpNotFound();
  return toTopUpDto(row);
}

/** Antrean super admin: PENDING terlama dulu; status lain terbaru dulu. */
export async function listPlatformTopUps(query: PlatformTopUpsQuery): Promise<{ data: PlatformTopUpDto[]; meta: PageMeta }> {
  const where: Prisma.TopUpRequestWhereInput = { status: query.status, ...(query.sponsorId ? { sponsorId: query.sponsorId } : {}) };
  const orderBy: Prisma.TopUpRequestOrderByWithRelationInput[] =
    query.status === "PENDING" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.topUpRequest.count({ where }),
    prisma.topUpRequest.findMany({ where, orderBy, ...toSkipTake(query), select: PLATFORM_SELECT }),
  ]);
  return { data: toPlatformDtos(rows, await duplicatesOf(prisma, rows)), meta: pageMeta(total, query.page, query.limit) };
}

export async function getPlatformTopUp(db: Db | Tx, id: string): Promise<PlatformTopUpDto> {
  const row = await db.topUpRequest.findFirst({ where: { id }, select: PLATFORM_SELECT });
  if (!row) throw topUpNotFound();
  const [dto] = toPlatformDtos([row], await duplicatesOf(db, [row]));
  if (!dto) throw topUpNotFound();
  return dto;
}

export const getTopUpForReview = (id: string): Promise<PlatformTopUpDto> => getPlatformTopUp(prisma, id);
