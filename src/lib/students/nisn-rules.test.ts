import { test } from "node:test";
import assert from "node:assert/strict";
import { decideNisnClaim } from "./nisn-rules";

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
