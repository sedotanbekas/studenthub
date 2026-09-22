import { test } from "node:test";
import assert from "node:assert/strict";
import { AD_ERROR_STATUS, adError, assertAdRule, failAd } from "@/lib/ads/errors";
import { ERROR_STATUS, statusForCode } from "@/lib/http/error-status";
import { assertSponsorRule, failSponsor, sponsorError, SPONSOR_ERROR_STATUS } from "./errors";

test("peta status domain sponsor & iklan (dilempar lewat helper, tak terlihat pemindai) konsisten dengan ERROR_STATUS", () => {
  const all = { ...SPONSOR_ERROR_STATUS, ...AD_ERROR_STATUS };
  const mismatched = Object.entries(all).filter(([code, status]) => !Object.hasOwn(ERROR_STATUS, code) || statusForCode(code) !== status);
  assert.deepEqual(mismatched, []);
});

test("helper pelanggaran menghasilkan AppError dengan status & detail", () => {
  const err = sponsorError({ code: "TOPUP_LIMIT", message: "x", details: { max: 3 } });
  assert.equal(err.status, 409);
  assert.deepEqual(err.details, { max: 3 });
  assert.equal(adError({ code: "AD_LINK_INVALID", message: "y" }).status, 422);
  assert.throws(() => failSponsor({ code: "INSUFFICIENT_BALANCE", message: "z" }), { code: "INSUFFICIENT_BALANCE" });
  assert.throws(() => failAd({ code: "AD_TOKEN_INVALID", message: "z" }), { status: 403 });
  assert.doesNotThrow(() => assertSponsorRule(null));
  assert.doesNotThrow(() => assertAdRule(null));
  assert.throws(() => assertAdRule({ code: "AD_REVIEW_STALE", message: "z" }), { status: 409 });
});
