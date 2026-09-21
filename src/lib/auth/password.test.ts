import { test } from "node:test";
import assert from "node:assert/strict";
import { checkPasswordPolicy, generateTempPassword, hashPassword, TEMP_PASSWORD_LENGTH, verifyPassword } from "./password";

test("hash & verifikasi", async () => {
  const h = await hashPassword("Rahasia123", 4);
  assert.equal(await verifyPassword("Rahasia123", h), true);
  assert.equal(await verifyPassword("salah123", h), false);
  assert.equal(await verifyPassword("apapun123", null), false);
});

test("generateTempPassword panjang, alfabet, huruf+angka, deterministik dengan rand injeksi", () => {
  for (let i = 0; i < 50; i += 1) {
    const pw = generateTempPassword();
    assert.equal(pw.length, TEMP_PASSWORD_LENGTH);
    assert.match(pw, /^[2-9a-km-zA-HJ-NP-Z]+$/);
    assert.match(pw, /\d/);
    assert.match(pw, /[a-z]/i);
  }
  let seed = 7;
  const rand = (n: number) => Uint8Array.from({ length: n }, () => (seed = (seed * 31 + 11) % 251));
  const a = generateTempPassword(rand);
  seed = 7;
  assert.equal(generateTempPassword(rand), a);
});

test("kebijakan kata sandi", () => {
  assert.deepEqual(checkPasswordPolicy("Abcdefg1"), []);
  assert.ok(checkPasswordPolicy("abc1").includes("TOO_SHORT"));
  assert.ok(checkPasswordPolicy("abcdefgh").includes("NEEDS_DIGIT"));
  assert.ok(checkPasswordPolicy("12345678").includes("NEEDS_LETTER"));
  assert.ok(checkPasswordPolicy("x".repeat(73) + "1").includes("TOO_LONG"));
  assert.ok(checkPasswordPolicy("ab0012345678", { nisn: "0012345678" }).includes("CONTAINS_PERSONAL_DATA"));
  assert.ok(checkPasswordPolicy("lahir21092010x", { birthDate: new Date("2010-09-21T00:00:00Z") }).includes("CONTAINS_PERSONAL_DATA"));
  assert.ok(checkPasswordPolicy("Qwerty123").includes("TOO_COMMON"));
});
