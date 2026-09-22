import type { LedgerEntryType, SponsorStatus } from "@prisma/client";
import { addDays, type LocalDate } from "@/lib/time/zone";
import { ADJUSTMENT_MAX_ABS, MAX_PENDING_TOPUPS, TOPUP_MAX, TOPUP_MAX_TRANSFER_AGE_DAYS, TOPUP_MIN_FLOOR } from "./constants";
import { sponsorViolation, type SponsorViolation } from "./errors";

/** Aturan murni sponsor: transisi akun, ledger saldo, peringatan saldo, top-up (tanpa Prisma). */

export type SponsorAction = "approve" | "suspend" | "reactivate";

const SPONSOR_TRANSITIONS: Readonly<Record<SponsorAction, Partial<Record<SponsorStatus, SponsorStatus>>>> = {
  approve: { PENDING: "APPROVED" },
  suspend: { PENDING: "SUSPENDED", APPROVED: "SUSPENDED" },
  reactivate: { SUSPENDED: "APPROVED" },
};

/** Status berikutnya, atau null bila transisi tidak sah (-> 409 SPONSOR_INVALID_TRANSITION). */
export function nextSponsorStatus(current: SponsorStatus, action: SponsorAction): SponsorStatus | null {
  return SPONSOR_TRANSITIONS[action][current] ?? null;
}

// ----------------------------------------------------------------------------- ledger

const SIGN_OK: Readonly<Record<LedgerEntryType, (amount: number) => boolean>> = {
  TOPUP: (amount) => amount > 0,
  CLICK_CHARGE: (amount) => amount < 0,
  ADJUSTMENT: (amount) => amount !== 0 && Math.abs(amount) <= ADJUSTMENT_MAX_ABS,
};

/** Tanda nominal per tipe (sama dengan CHECK chk_ledger_amount) + batas penyesuaian. */
export function ledgerAmountViolation(type: LedgerEntryType, amount: number): SponsorViolation | null {
  if (Number.isInteger(amount) && SIGN_OK[type](amount)) return null;
  return sponsorViolation("LEDGER_AMOUNT_INVALID", "Nominal entri ledger tidak sesuai tipenya.", { type, amount });
}

export type BalanceResult = { readonly ok: true; readonly balance: number } | { readonly ok: false; readonly violation: SponsorViolation };

export function nextBalance(balance: number, amount: number): BalanceResult {
  const after = balance + amount;
  if (after >= 0) return { ok: true, balance: after };
  return { ok: false, violation: sponsorViolation("INSUFFICIENT_BALANCE", "Saldo sponsor tidak mencukupi.", { balance, amount }) };
}

export type BalanceAlert = "LOW" | "EXHAUSTED";

/**
 * Peringatan hanya saat MELEWATI ambang (sebelum >= ambang > sesudah), sehingga satu penurunan = satu
 * notifikasi tanpa status dedupe; top-up otomatis "mempersenjatai" ulang. Habis (di bawah CPC) didahulukan.
 */
export function detectBalanceAlert(before: number, after: number, threshold: number, cpc: number): BalanceAlert | null {
  if (after >= before) return null;
  if (before >= cpc && after < cpc) return "EXHAUSTED";
  if (before >= threshold && after < threshold) return "LOW";
  return null;
}

export interface BalanceAggregates {
  readonly balance: number;
  readonly totalTopUp: number;
  readonly totalSpent: number;
  readonly netAdjustment: number;
  readonly defaultCpc: number;
}

export interface BalanceSummary {
  readonly balance: number;
  readonly totalTopUp: number;
  readonly totalSpent: number;
  readonly netAdjustment: number;
  readonly estimatedClicksRemaining: number;
}

/** Kartu saldo "sisa <balance> dari total top-up <totalTopUp>". */
export function summarizeBalance(a: BalanceAggregates): BalanceSummary {
  return {
    balance: a.balance,
    totalTopUp: a.totalTopUp,
    totalSpent: a.totalSpent,
    netAdjustment: a.netAdjustment,
    estimatedClicksRemaining: a.defaultCpc > 0 ? Math.floor(a.balance / a.defaultCpc) : 0,
  };
}

// ----------------------------------------------------------------------------- top-up

export const effectiveMinTopUp = (minTopUpAmount: number): number => Math.max(minTopUpAmount, TOPUP_MIN_FLOOR);

export interface TopUpCandidate {
  readonly amount: number;
  readonly transferDate: LocalDate;
  readonly pendingCount: number;
}

export function topUpViolation(c: TopUpCandidate, settings: { readonly minTopUpAmount: number }, today: LocalDate): SponsorViolation | null {
  if (c.pendingCount >= MAX_PENDING_TOPUPS) {
    return sponsorViolation("TOPUP_LIMIT", `Maksimal ${MAX_PENDING_TOPUPS} pengajuan top-up menunggu verifikasi.`, { max: MAX_PENDING_TOPUPS });
  }
  const min = effectiveMinTopUp(settings.minTopUpAmount);
  if (!Number.isInteger(c.amount) || c.amount < min || c.amount > TOPUP_MAX) {
    return sponsorViolation("TOPUP_AMOUNT_INVALID", `Nominal top-up harus antara ${min} dan ${TOPUP_MAX}.`, { min, max: TOPUP_MAX });
  }
  const earliest = addDays(today, -TOPUP_MAX_TRANSFER_AGE_DAYS);
  if (c.transferDate > today || c.transferDate < earliest) {
    return sponsorViolation("TRANSFER_DATE_OUT_OF_RANGE", `Tanggal transfer harus antara ${earliest} dan ${today}.`, { earliest, latest: today });
  }
  return null;
}
