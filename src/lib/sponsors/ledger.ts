import type { LedgerEntryType, SponsorStatus } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import { lockRows } from "@/lib/tx";
import { failSponsor } from "./errors";
import { ledgerAmountViolation, nextBalance } from "./rules";

/**
 * SATU-SATUNYA jalur perubahan saldo sponsor. Urutan (lihat src/lib/tx.ts): Sponsor FOR UPDATE PALING
 * AWAL -> baca ulang -> entri ledger seq+1 (balanceAfter) -> CAS Sponsor.balance = saldo terkunci.
 * CHECK `balance >= 0` & `chk_ledger_amount` di DB adalah benteng terakhir.
 */
export interface LockedSponsor {
  readonly id: string;
  readonly status: SponsorStatus;
  readonly balance: number;
  readonly companyName: string;
}

export const sponsorNotFound = () => notFound("Sponsor tidak ditemukan.", "SPONSOR_NOT_FOUND");

export async function lockSponsor(tx: Tx, sponsorId: string): Promise<LockedSponsor> {
  await lockRows(tx, "Sponsor", [sponsorId]);
  const row = await tx.sponsor.findFirst({ where: { id: sponsorId }, select: { id: true, status: true, balance: true, companyName: true } });
  if (!row) throw sponsorNotFound();
  return row;
}

export interface LedgerWrite {
  readonly type: LedgerEntryType;
  readonly amount: number;
  readonly note?: string | null;
  readonly topUpRequestId?: string | null;
  readonly adClickId?: string | null;
  readonly createdById?: string | null;
}

export interface AppendedEntry {
  readonly id: string;
  readonly seq: number;
  readonly balanceAfter: number;
  readonly createdAt: Date;
}

/** Tambah entri ledger & perbarui saldo; `locked` WAJIB hasil lockSponsor di transaksi yang sama. */
export async function appendLedgerEntry(tx: Tx, locked: LockedSponsor, entry: LedgerWrite, now: Date): Promise<AppendedEntry> {
  const signViolation = ledgerAmountViolation(entry.type, entry.amount);
  if (signViolation) failSponsor(signViolation);
  const next = nextBalance(locked.balance, entry.amount);
  if (!next.ok) failSponsor(next.violation);
  const last = await tx.sponsorLedgerEntry.findFirst({ where: { sponsorId: locked.id }, orderBy: { seq: "desc" }, select: { seq: true } });
  const created = await tx.sponsorLedgerEntry.create({
    data: {
      sponsorId: locked.id,
      seq: (last?.seq ?? 0) + 1,
      type: entry.type,
      amount: entry.amount,
      balanceAfter: next.balance,
      note: entry.note ?? null,
      topUpRequestId: entry.topUpRequestId ?? null,
      adClickId: entry.adClickId ?? null,
      createdById: entry.createdById ?? null,
      createdAt: now,
    },
    select: { id: true, seq: true, balanceAfter: true, createdAt: true },
  });
  const updated = await tx.sponsor.updateMany({ where: { id: locked.id, balance: locked.balance }, data: { balance: next.balance } });
  if (updated.count !== 1) throw conflict("CONFLICT_RETRY", "Saldo sponsor berubah bersamaan. Coba lagi.");
  return created;
}
