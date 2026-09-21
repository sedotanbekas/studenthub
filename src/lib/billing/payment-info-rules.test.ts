import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaymentInfo } from "./payment-info-rules";

const NOW = new Date("2026-09-21T03:00:00Z");
const DAY = 86_400_000;
const bank = { bankName: "BRI", bankAccountNumber: "0123456789", bankAccountHolder: "SMP Contoh" };

test("rekening belum diatur -> semua null + pemberitahuan hubungi sekolah", () => {
  const info = buildPaymentInfo({ bankName: null, bankAccountNumber: null, bankAccountHolder: null, bankChangedAt: null }, NOW, "WIB");
  assert.equal(info.bankName, null);
  assert.equal(info.bankRecentlyChanged, false);
  assert.match(info.notice, /belum/);
});

test("rekening berubah < 14 hari -> ditandai + tanggal perubahan di pemberitahuan", () => {
  const changedAt = new Date(NOW.getTime() - 13 * DAY);
  const info = buildPaymentInfo({ ...bank, bankChangedAt: changedAt }, NOW, "WIB");
  assert.equal(info.bankRecentlyChanged, true);
  assert.equal(info.bankChangedAt, changedAt.toISOString());
  assert.match(info.notice, /8 September 2026/);
});

test("rekening berubah >= 14 hari lalu atau tanpa tanggal -> tidak ditandai", () => {
  assert.equal(buildPaymentInfo({ ...bank, bankChangedAt: new Date(NOW.getTime() - 14 * DAY) }, NOW, "WIB").bankRecentlyChanged, false);
  const info = buildPaymentInfo({ ...bank, bankChangedAt: null }, NOW, "WIB");
  assert.equal(info.bankRecentlyChanged, false);
  assert.equal(info.bankAccountNumber, "0123456789");
  assert.match(info.notice, /rekening resmi/);
});
