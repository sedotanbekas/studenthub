import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeIdPhone } from "./phone";

test("normalizeIdPhone: awalan 08 / 62 / +62 dinormalisasi ke +628…", () => {
  assert.equal(normalizeIdPhone("081234567890"), "+6281234567890");
  assert.equal(normalizeIdPhone("0812-3456-7890"), "+6281234567890");
  assert.equal(normalizeIdPhone("+62 812 3456 7890"), "+6281234567890");
  assert.equal(normalizeIdPhone("6281234567890"), "+6281234567890");
  assert.equal(normalizeIdPhone("(0812) 3456.7890"), "+6281234567890");
});

test("normalizeIdPhone: batas panjang badan nomor 8 s.d. 12 digit", () => {
  assert.equal(normalizeIdPhone("081234567"), "+6281234567");
  assert.equal(normalizeIdPhone("08123456"), null);
  assert.equal(normalizeIdPhone("0812345678901"), "+62812345678901");
  assert.equal(normalizeIdPhone("08123456789012"), null);
});

test("normalizeIdPhone: nomor tidak valid -> null", () => {
  assert.equal(normalizeIdPhone("021-5551234"), null);
  assert.equal(normalizeIdPhone("0812345"), null);
  assert.equal(normalizeIdPhone("0801234567"), null);
  assert.equal(normalizeIdPhone("81234567890"), null);
  assert.equal(normalizeIdPhone("08abc4567890"), null);
  assert.equal(normalizeIdPhone(""), null);
  assert.equal(normalizeIdPhone("+1 812 3456 7890"), null);
});
