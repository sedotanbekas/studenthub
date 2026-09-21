import { test } from "node:test";
import assert from "node:assert/strict";
import { NISN_RELEASE_DAILY_LIMIT, claimedCountOf, decideNisnClaim, isReleaseQuotaExempt, localDayWindow, releaseQuotaVerdict } from "./nisn-rules";

test("tanpa pemegang -> CLAIM", () => {
  assert.equal(decideNisnClaim(null, "self"), "CLAIM");
  assert.equal(decideNisnClaim(null, null), "CLAIM");
});

test("pemegang adalah diri sendiri -> CLAIM (idempoten)", () => {
  assert.equal(decideNisnClaim({ id: "self", status: "INACTIVE" }, "self"), "CLAIM");
  assert.equal(decideNisnClaim({ id: "self", status: "GRADUATED" }, "self"), "CLAIM");
});

test("pemegang LULUS di sekolah lain -> RELEASE_AND_CLAIM", () => {
  assert.equal(decideNisnClaim({ id: "other", status: "GRADUATED" }, "self"), "RELEASE_AND_CLAIM");
  assert.equal(decideNisnClaim({ id: "other", status: "GRADUATED" }, null), "RELEASE_AND_CLAIM");
});

test("pemegang AKTIF / NONAKTIF -> CONFLICT", () => {
  assert.equal(decideNisnClaim({ id: "other", status: "ACTIVE" }, "self"), "CONFLICT");
  assert.equal(decideNisnClaim({ id: "other", status: "INACTIVE" }, "self"), "CONFLICT");
});

test("status yang mustahil memegang NISN (DRAFT/MOVED) diperlakukan konflik (defensif)", () => {
  assert.equal(decideNisnClaim({ id: "other", status: "DRAFT" }, "self"), "CONFLICT");
  assert.equal(decideNisnClaim({ id: "other", status: "MOVED" }, "self"), "CONFLICT");
});

test("kuota pelepasan: super admin dikecualikan; peran lain tidak", () => {
  assert.equal(isReleaseQuotaExempt("SUPER_ADMIN"), true);
  assert.equal(isReleaseQuotaExempt("SCHOOL_ADMIN"), false);
  assert.equal(isReleaseQuotaExempt(null), false);
});

test("claimedCountOf: after.count bilangan bulat positif; data tak sah dihitung 1 (konservatif)", () => {
  assert.equal(claimedCountOf({ count: 7, nisns: [] }), 7);
  assert.equal(claimedCountOf({ count: 0 }), 1);
  assert.equal(claimedCountOf({ count: "5" }), 1);
  assert.equal(claimedCountOf(null), 1);
});

test("releaseQuotaVerdict: tepat sampai batas diizinkan, melebihi ditolak", () => {
  assert.deepEqual(releaseQuotaVerdict(0, NISN_RELEASE_DAILY_LIMIT), { allowed: true, used: 0, remaining: NISN_RELEASE_DAILY_LIMIT });
  assert.deepEqual(releaseQuotaVerdict(19, 1), { allowed: true, used: 19, remaining: 1 });
  assert.deepEqual(releaseQuotaVerdict(19, 2), { allowed: false, used: 19, remaining: 1 });
  assert.deepEqual(releaseQuotaVerdict(25, 1), { allowed: false, used: 25, remaining: 0 });
  assert.equal(NISN_RELEASE_DAILY_LIMIT, 20);
});

test("localDayWindow: hari lokal WIB/WIT (UTC+7/+9)", () => {
  const wib = localDayWindow(new Date("2026-09-21T17:30:00.000Z"), "WIB");
  assert.equal(wib.start.toISOString(), "2026-09-21T17:00:00.000Z");
  assert.equal(wib.end.toISOString(), "2026-09-22T17:00:00.000Z");
  const wit = localDayWindow(new Date("2026-09-21T14:59:59.000Z"), "WIT");
  assert.equal(wit.start.toISOString(), "2026-09-20T15:00:00.000Z");
  assert.equal(wit.end.toISOString(), "2026-09-21T15:00:00.000Z");
});
