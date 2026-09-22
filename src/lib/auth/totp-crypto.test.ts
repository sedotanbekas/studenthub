import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decryptTotpSecret, encryptTotpSecret, parseTotpKey } from "./totp-crypto";

const KEY = randomBytes(32);
const SECRET = Buffer.from("12345678901234567890", "ascii");

test("parseTotpKey: 64 hex atau base64 32 byte", () => {
  const hex = KEY.toString("hex");
  assert.deepEqual(parseTotpKey(hex), KEY);
  assert.deepEqual(parseTotpKey(hex.toUpperCase()), KEY);
  assert.deepEqual(parseTotpKey(KEY.toString("base64")), KEY);
});

test("parseTotpKey: panjang/format salah -> null", () => {
  assert.equal(parseTotpKey(""), null);
  assert.equal(parseTotpKey("abcd"), null);
  assert.equal(parseTotpKey(randomBytes(16).toString("hex")), null);
  assert.equal(parseTotpKey(randomBytes(31).toString("base64")), null);
  assert.equal(parseTotpKey("z".repeat(64)), null);
  assert.equal(parseTotpKey("ganti-dengan-rahasia-acak-minimal-32-karakter-aaaa"), null);
});

test("encrypt/decrypt: roundtrip; format v1 tidak memuat rahasia mentah; IV acak", () => {
  const a = encryptTotpSecret(SECRET, "user_1", KEY);
  const b = encryptTotpSecret(SECRET, "user_1", KEY);
  assert.match(a, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b);
  assert.ok(a.length <= 255);
  assert.equal(a.includes(SECRET.toString("base64url")), false);
  assert.deepEqual(decryptTotpSecret(a, "user_1", KEY), SECRET);
});

test("decrypt: user lain (AAD), kunci lain, atau data rusak -> null", () => {
  const blob = encryptTotpSecret(SECRET, "user_1", KEY);
  assert.equal(decryptTotpSecret(blob, "user_2", KEY), null);
  assert.equal(decryptTotpSecret(blob, "user_1", randomBytes(32)), null);
  const parts = blob.split(".");
  const tampered = [parts[0], parts[1], Buffer.from("xxxxxxxxxxxxxxxxxxxx").toString("base64url"), parts[3]].join(".");
  assert.equal(decryptTotpSecret(tampered, "user_1", KEY), null);
  assert.equal(decryptTotpSecret("v2.a.b.c", "user_1", KEY), null);
  assert.equal(decryptTotpSecret("rusak", "user_1", KEY), null);
  assert.equal(decryptTotpSecret(`v1.${parts[1]}.${parts[2]}.AAAA`, "user_1", KEY), null);
});
