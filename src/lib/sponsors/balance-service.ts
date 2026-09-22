import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { withTx } from "@/lib/tx";
import { appendLedgerEntry, lockSponsor } from "./ledger";
import type { LedgerEntryDto } from "./response-schemas";
import type { AdjustmentInput } from "./schemas";

/**
 * Penyesuaian saldo (ADJUSTMENT) oleh super admin: bertanda, catatan wajib, diaudit. Saldo tidak boleh negatif
 * (422 INSUFFICIENT_BALANCE, tanpa baris ledger). REFUND ditunda (backlog PLAN).
 */
export async function adjustBalance(sponsorId: string, input: AdjustmentInput, ctx: ActionContext): Promise<LedgerEntryDto> {
  const actor = requirePrincipal(ctx);
  return withTx(async (tx) => {
    const locked = await lockSponsor(tx, sponsorId);
    const entry = await appendLedgerEntry(tx, locked, { type: "ADJUSTMENT", amount: input.amount, note: input.note, createdById: actor.userId }, ctx.now);
    const audit = { before: { balance: locked.balance }, after: { balance: entry.balanceAfter, amount: input.amount, note: input.note, seq: entry.seq } };
    await writeAudit(tx, { action: "sponsor.ledger.adjust", entityType: "Sponsor", entityId: sponsorId, ...audit }, ctx);
    return {
      id: entry.id, seq: entry.seq, type: "ADJUSTMENT", amount: input.amount, balanceAfter: entry.balanceAfter, note: input.note,
      topUpRequestId: null, adId: null, createdAt: entry.createdAt.toISOString(),
    };
  });
}
