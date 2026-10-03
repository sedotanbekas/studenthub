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

test("parseEnv: SUPER_ADMIN_TOTP bawaan off (keputusan pemilik 2026-10-02); hanya on/off", () => {
  assert.equal(parseEnv(BASE).SUPER_ADMIN_TOTP, "off");
  assert.equal(parseEnv({ ...BASE, SUPER_ADMIN_TOTP: "on" }).SUPER_ADMIN_TOTP, "on");
  assert.throws(() => parseEnv({ ...BASE, SUPER_ADMIN_TOTP: "ya" }), /SUPER_ADMIN_TOTP/);
});

test("parseEnv: produksi wajib DOCS_BASIC_AUTH", () => {
  assert.throws(() => parseEnv({ ...BASE, NODE_ENV: "production" }), /DOCS_BASIC_AUTH wajib/);
});

test("parseEnv: kunci VAPID (N3) berdua atau tidak sama sekali; kosong = tidak diisi; harus sah", async () => {
  const { generateVapidKeys } = await import("./push/web/vapid-keys");
  const keys = generateVapidKeys();
  const none = parseEnv({ ...BASE, VAPID_PUBLIC_KEY: "", VAPID_PRIVATE_KEY: "" });
  assert.equal(none.VAPID_PUBLIC_KEY, undefined);
  assert.equal(none.VAPID_PRIVATE_KEY, undefined);
  const both = parseEnv({ ...BASE, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "mailto:ops@studenthub.id" });
  assert.equal(both.VAPID_PUBLIC_KEY, keys.publicKey);
  assert.throws(() => parseEnv({ ...BASE, VAPID_PUBLIC_KEY: keys.publicKey }), /berdua/);
  assert.throws(() => parseEnv({ ...BASE, VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: "rusak" }), /tidak valid/);
});
