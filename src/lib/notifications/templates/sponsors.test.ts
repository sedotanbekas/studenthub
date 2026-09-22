import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adApprovedNotification,
  adRejectedNotification,
  adSubmittedNotification,
  lowBalanceNotification,
  sponsorApprovedNotification,
  sponsorSuspendedNotification,
  topUpApprovedNotification,
  topUpRejectedNotification,
  topUpSubmittedNotification,
} from "./sponsors";

test("notifikasi akun sponsor", () => {
  assert.equal(sponsorApprovedNotification({ sponsorId: "sp", reactivated: false }).type, "SPONSOR_APPROVED");
  assert.match(sponsorApprovedNotification({ sponsorId: "sp", reactivated: true }).body, /diaktifkan kembali/);
  const suspended = sponsorSuspendedNotification({ sponsorId: "sp", reason: "Pelanggaran konten" });
  assert.equal(suspended.type, "SPONSOR_SUSPENDED");
  assert.match(suspended.body, /Pelanggaran konten/);
});

test("notifikasi review iklan", () => {
  const submitted = adSubmittedNotification({ adId: "a1", title: "Promo", companyName: "PT X" });
  assert.equal(submitted.type, "AD_SUBMITTED");
  assert.deepEqual(submitted.link, { screen: "ad-review", id: "a1" });
  assert.equal(adApprovedNotification({ adId: "a1", title: "Promo" }).type, "AD_APPROVED");
  const rejected = adRejectedNotification({ adId: "a1", title: "Promo", reason: "Gambar buram", takedown: false });
  assert.match(rejected.body, /Gambar buram/);
  assert.match(adRejectedNotification({ adId: "a1", title: "Promo", reason: "Melanggar", takedown: true }).title, /diturunkan/);
});

test("notifikasi top-up & saldo memakai format rupiah", () => {
  assert.match(topUpSubmittedNotification({ topUpId: "t1", companyName: "PT X", amount: 250_000 }).body, /Rp 250\.000/);
  const approved = topUpApprovedNotification({ topUpId: "t1", amount: 250_000, balance: 1_250_000 });
  assert.equal(approved.type, "TOPUP_APPROVED");
  assert.match(approved.body, /Rp 1\.250\.000/);
  assert.match(topUpRejectedNotification({ topUpId: "t1", amount: 250_000, reason: "Bukti tidak terbaca" }).body, /Bukti tidak terbaca/);
  assert.match(lowBalanceNotification({ sponsorId: "sp", level: "LOW", balance: 99_500 }).title, /menipis/);
  assert.match(lowBalanceNotification({ sponsorId: "sp", level: "EXHAUSTED", balance: 0 }).title, /habis/);
});
