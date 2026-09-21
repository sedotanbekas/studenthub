import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyJobSecret } from "./secret";

const SECRET = "rahasia-job-0123456789abcdef0123456789";

test("verifyJobSecret: header hilang (null) → false", () => {
  assert.equal(verifyJobSecret(null, SECRET), false);
});

test("verifyJobSecret: header kosong → false", () => {
  assert.equal(verifyJobSecret("", SECRET), false);
});

test("verifyJobSecret: header salah (panjang sama maupun berbeda) → false", () => {
  assert.equal(verifyJobSecret(SECRET.replace(/9$/, "8"), SECRET), false);
  assert.equal(verifyJobSecret("pendek", SECRET), false);
  assert.equal(verifyJobSecret(`${SECRET}x`, SECRET), false);
});

test("verifyJobSecret: header benar → true", () => {
  assert.equal(verifyJobSecret(SECRET, SECRET), true);
});

test("verifyJobSecret: secret server kosong tidak pernah cocok", () => {
  assert.equal(verifyJobSecret("", ""), false);
  assert.equal(verifyJobSecret("apa-saja", ""), false);
});
