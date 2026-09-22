import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "./env";

const BASE: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "mysql://u:p@127.0.0.1:3307/studenthub_test",
  JWT_ACCESS_SECRET: "a".repeat(40),
  AD_EVENT_SECRET: "b".repeat(40),
  JOB_SECRET: "c".repeat(40),
  TOTP_ENC_KEY: "0123456789abcdef".repeat(4),
  APP_ORIGIN: "http://localhost:3030/",
  PUBLIC_MEDIA_BASE_URL: "http://localhost:3030/media",
  STORAGE_ROOT: "./.storage",
};

test("parseEnv: TOTP_ENC_KEY hex 64 karakter atau base64 32 byte diterima", () => {
  assert.equal(parseEnv(BASE).TOTP_ENC_KEY, BASE.TOTP_ENC_KEY);
  const base64 = Buffer.alloc(32, 7).toString("base64");
  assert.equal(parseEnv({ ...BASE, TOTP_ENC_KEY: base64 }).TOTP_ENC_KEY, base64);
  assert.equal(parseEnv(BASE).APP_ORIGIN, "http://localhost:3030");
});

test("parseEnv: TOTP_ENC_KEY hilang, salah panjang, atau sama dengan rahasia lain ditolak", () => {
  const withoutKey = Object.fromEntries(Object.entries(BASE).filter(([key]) => key !== "TOTP_ENC_KEY"));
  assert.throws(() => parseEnv(withoutKey), /TOTP_ENC_KEY wajib diisi/);
  assert.throws(() => parseEnv({ ...BASE, TOTP_ENC_KEY: "abcd".repeat(8) }), /TOTP_ENC_KEY harus 32 byte/);
  assert.throws(() => parseEnv({ ...BASE, TOTP_ENC_KEY: "g".repeat(64) }), /TOTP_ENC_KEY harus 32 byte/);
  assert.throws(() => parseEnv({ ...BASE, TOTP_ENC_KEY: "ab".repeat(32), JOB_SECRET: "ab".repeat(32) }), /harus berbeda/);
});

test("parseEnv: produksi wajib DOCS_BASIC_AUTH", () => {
  assert.throws(() => parseEnv({ ...BASE, NODE_ENV: "production" }), /DOCS_BASIC_AUTH wajib/);
});
