import { localParts, type SchoolTz } from "@/lib/time/zone";
import { BANK_CHANGE_NOTICE_DAYS } from "./constants";
import { formatLocalDate } from "./format";

/**
 * Info rekening SPP untuk siswa (murni). Rekening hanya diubah SUPER_ADMIN (anti-pengalihan); selama
 * BANK_CHANGE_NOTICE_DAYS hari sejak bankChangedAt siswa diberi peringatan agar memastikan tujuan transfer.
 */
export interface SchoolBank {
  readonly bankName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankAccountHolder: string | null;
  readonly bankChangedAt: Date | null;
}

export interface PaymentInfo {
  readonly bankName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankAccountHolder: string | null;
  readonly bankChangedAt: string | null;
  readonly bankRecentlyChanged: boolean;
  readonly notice: string;
}

const DAY_MS = 86_400_000;

export function isBankRecentlyChanged(bankChangedAt: Date | null, now: Date): boolean {
  if (!bankChangedAt) return false;
  const age = now.getTime() - bankChangedAt.getTime();
  return age >= 0 && age < BANK_CHANGE_NOTICE_DAYS * DAY_MS;
}

function noticeFor(configured: boolean, recentlyChanged: boolean, changedDate: string | null): string {
  if (!configured) return "Rekening SPP sekolah belum diatur. Hubungi admin sekolah sebelum melakukan transfer.";
  if (recentlyChanged && changedDate) {
    return `Perhatian: rekening SPP sekolah berubah pada ${changedDate}. Pastikan Anda mentransfer ke rekening yang tertera di sini.`;
  }
  return "Transfer hanya ke rekening resmi sekolah yang tertera di sini, lalu unggah bukti transfer pada tagihan.";
}

export function buildPaymentInfo(bank: SchoolBank, now: Date, tz: SchoolTz): PaymentInfo {
  const configured = Boolean(bank.bankName && bank.bankAccountNumber && bank.bankAccountHolder);
  const recentlyChanged = configured && isBankRecentlyChanged(bank.bankChangedAt, now);
  const changedDate = bank.bankChangedAt ? formatLocalDate(localParts(bank.bankChangedAt, tz).ymd) : null;
  return {
    bankName: bank.bankName,
    bankAccountNumber: bank.bankAccountNumber,
    bankAccountHolder: bank.bankAccountHolder,
    bankChangedAt: bank.bankChangedAt?.toISOString() ?? null,
    bankRecentlyChanged: recentlyChanged,
    notice: noticeFor(configured, recentlyChanged, changedDate),
  };
}
