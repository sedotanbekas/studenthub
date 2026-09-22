import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectBalanceAlert,
  effectiveMinTopUp,
  ledgerAmountViolation,
  nextBalance,
  nextSponsorStatus,
  summarizeBalance,
  topUpViolation,
} from "./rules";

const TODAY = "2026-09-21";

test("transisi sponsor: approve PENDING, suspend PENDING/APPROVED, reactivate SUSPENDED; lainnya null", () => {
  assert.equal(nextSponsorStatus("PENDING", "approve"), "APPROVED");
  assert.equal(nextSponsorStatus("APPROVED", "approve"), null);
  assert.equal(nextSponsorStatus("SUSPENDED", "approve"), null);
  assert.equal(nextSponsorStatus("PENDING", "suspend"), "SUSPENDED");
  assert.equal(nextSponsorStatus("APPROVED", "suspend"), "SUSPENDED");
  assert.equal(nextSponsorStatus("SUSPENDED", "suspend"), null);
  assert.equal(nextSponsorStatus("SUSPENDED", "reactivate"), "APPROVED");
  assert.equal(nextSponsorStatus("APPROVED", "reactivate"), null);
  assert.equal(nextSponsorStatus("PENDING", "reactivate"), null);
});

test("tanda nominal ledger per tipe; nol ditolak; penyesuaian dibatasi 100 juta", () => {
  assert.equal(ledgerAmountViolation("TOPUP", 100_000), null);
  assert.equal(ledgerAmountViolation("TOPUP", -1)?.code, "LEDGER_AMOUNT_INVALID");
  assert.equal(ledgerAmountViolation("TOPUP", 0)?.code, "LEDGER_AMOUNT_INVALID");
  assert.equal(ledgerAmountViolation("CLICK_CHARGE", -500), null);
  assert.equal(ledgerAmountViolation("CLICK_CHARGE", 500)?.code, "LEDGER_AMOUNT_INVALID");
  assert.equal(ledgerAmountViolation("ADJUSTMENT", -1), null);
  assert.equal(ledgerAmountViolation("ADJUSTMENT", 1), null);
  assert.equal(ledgerAmountViolation("ADJUSTMENT", 0)?.code, "LEDGER_AMOUNT_INVALID");
  assert.equal(ledgerAmountViolation("ADJUSTMENT", 100_000_000), null);
  assert.equal(ledgerAmountViolation("ADJUSTMENT", -100_000_001)?.code, "LEDGER_AMOUNT_INVALID");
  assert.equal(ledgerAmountViolation("TOPUP", 1.5)?.code, "LEDGER_AMOUNT_INVALID");
});

test("saldo berikutnya: negatif ditolak INSUFFICIENT_BALANCE, tepat nol diterima", () => {
  assert.deepEqual(nextBalance(1_000, -1_000), { ok: true, balance: 0 });
  assert.deepEqual(nextBalance(1_000, 500), { ok: true, balance: 1_500 });
  const result = nextBalance(1_000, -1_001);
  assert.equal(result.ok, false);
  assert.equal(result.ok ? null : result.violation.code, "INSUFFICIENT_BALANCE");
});

test("peringatan saldo hanya saat melewati ambang (sekali per penurunan)", () => {
  assert.equal(detectBalanceAlert(100_000, 99_500, 100_000, 500), "LOW");
  assert.equal(detectBalanceAlert(150_000, 120_000, 100_000, 500), null);
  assert.equal(detectBalanceAlert(99_500, 99_000, 100_000, 500), null, "sudah di bawah ambang");
  assert.equal(detectBalanceAlert(500, 0, 100_000, 500), "EXHAUSTED");
  assert.equal(detectBalanceAlert(100_000, 0, 100_000, 500), "EXHAUSTED", "habis didahulukan dari menipis");
  assert.equal(detectBalanceAlert(400, 0, 100_000, 500), null, "sudah di bawah CPC");
  assert.equal(detectBalanceAlert(50_000, 200_000, 100_000, 500), null, "kenaikan saldo");
});

test("ringkasan saldo: sisa dari total top-up + estimasi klik", () => {
  const summary = summarizeBalance({ balance: 1_250_000, totalTopUp: 2_000_000, totalSpent: 800_000, netAdjustment: 50_000, defaultCpc: 500 });
  assert.deepEqual(summary, {
    balance: 1_250_000,
    totalTopUp: 2_000_000,
    totalSpent: 800_000,
    netAdjustment: 50_000,
    estimatedClicksRemaining: 2_500,
  });
});

test("minimal top-up efektif tidak pernah di bawah lantai 10.000", () => {
  assert.equal(effectiveMinTopUp(100_000), 100_000);
  assert.equal(effectiveMinTopUp(5_000), 10_000);
});

test("aturan top-up: nominal, tanggal transfer, dan batas pengajuan menunggu", () => {
  const ok = { amount: 100_000, transferDate: TODAY, pendingCount: 0 };
  const settings = { minTopUpAmount: 100_000 };
  assert.equal(topUpViolation(ok, settings, TODAY), null);
  assert.equal(topUpViolation({ ...ok, amount: 99_999 }, settings, TODAY)?.code, "TOPUP_AMOUNT_INVALID");
  assert.equal(topUpViolation({ ...ok, amount: 100_000_001 }, settings, TODAY)?.code, "TOPUP_AMOUNT_INVALID");
  assert.equal(topUpViolation({ ...ok, amount: 100_000_000 }, settings, TODAY), null);
  assert.equal(topUpViolation({ ...ok, transferDate: "2026-09-22" }, settings, TODAY)?.code, "TRANSFER_DATE_OUT_OF_RANGE");
  assert.equal(topUpViolation({ ...ok, transferDate: "2026-08-22" }, settings, TODAY), null, "30 hari lalu masih boleh");
  assert.equal(topUpViolation({ ...ok, transferDate: "2026-08-21" }, settings, TODAY)?.code, "TRANSFER_DATE_OUT_OF_RANGE");
  assert.equal(topUpViolation({ ...ok, pendingCount: 2 }, settings, TODAY), null);
  assert.equal(topUpViolation({ ...ok, pendingCount: 3 }, settings, TODAY)?.code, "TOPUP_LIMIT");
});
