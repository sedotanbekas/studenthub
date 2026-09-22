import { Prisma, prisma, type Tx } from "@/lib/db";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";

/**
 * Rollup harian AdDailyStat (hari WIB) lewat INSERT ... ON DUPLICATE KEY UPDATE atomik. Waktu selalu dari
 * ctx.now (tanpa NOW() SQL). Baris impresi diurutkan adId agar batch bersamaan tidak saling deadlock.
 */
const sqlDateTime = (instant: Date): string => instant.toISOString().slice(0, 23).replace("T", " ");

export interface ImpressionRow {
  readonly adId: string;
  readonly sponsorId: string;
  readonly count: number;
}

export async function incrementImpressions(rows: readonly ImpressionRow[], date: LocalDate, now: Date): Promise<void> {
  if (rows.length === 0) return;
  const day = toDbDate(date);
  const at = sqlDateTime(now);
  const values = [...rows]
    .sort((a, b) => (a.adId < b.adId ? -1 : a.adId > b.adId ? 1 : 0))
    .map((r) => Prisma.sql`(${r.adId}, ${day}, ${r.sponsorId}, ${r.count}, 0, 0, 0, 0, ${at})`);
  await withTx((tx) => tx.$executeRaw`
    INSERT INTO \`AdDailyStat\` (\`adId\`, \`date\`, \`sponsorId\`, \`impressions\`, \`clicks\`, \`uniqueClicks\`, \`chargedClicks\`, \`spend\`, \`updatedAt\`)
    VALUES ${Prisma.join(values)}
    ON DUPLICATE KEY UPDATE \`impressions\` = \`impressions\` + VALUES(\`impressions\`), \`updatedAt\` = VALUES(\`updatedAt\`)`);
}

export interface ClickStat {
  readonly adId: string;
  readonly sponsorId: string;
  readonly date: LocalDate;
  readonly firstToday: boolean;
  readonly charged: boolean;
  readonly spend: number;
}

/** Klik: di transaksi yang sama dengan baris AdClick (& ledger bila ditagih) — pernyataan terakhir sebelum notifikasi. */
export async function incrementClickStat(tx: Tx, s: ClickStat, now: Date): Promise<void> {
  const unique = s.firstToday ? 1 : 0;
  const charged = s.charged ? 1 : 0;
  await tx.$executeRaw`
    INSERT INTO \`AdDailyStat\` (\`adId\`, \`date\`, \`sponsorId\`, \`impressions\`, \`clicks\`, \`uniqueClicks\`, \`chargedClicks\`, \`spend\`, \`updatedAt\`)
    VALUES (${s.adId}, ${toDbDate(s.date)}, ${s.sponsorId}, 0, 1, ${unique}, ${charged}, ${s.spend}, ${sqlDateTime(now)})
    ON DUPLICATE KEY UPDATE \`clicks\` = \`clicks\` + 1, \`uniqueClicks\` = \`uniqueClicks\` + VALUES(\`uniqueClicks\`),
      \`chargedClicks\` = \`chargedClicks\` + VALUES(\`chargedClicks\`), \`spend\` = \`spend\` + VALUES(\`spend\`), \`updatedAt\` = VALUES(\`updatedAt\`)`;
}

/** Iklan yang benar-benar ada dengan sponsor sesuai klaim token (id tak dikenal diabaikan). */
export async function existingAdSponsors(adIds: readonly string[]): Promise<Map<string, string>> {
  if (adIds.length === 0) return new Map();
  const rows = await prisma.ad.findMany({ where: { id: { in: [...adIds] } }, select: { id: true, sponsorId: true } });
  return new Map(rows.map((r) => [r.id, r.sponsorId]));
}
