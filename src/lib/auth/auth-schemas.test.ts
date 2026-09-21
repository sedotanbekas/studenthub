import { test } from "node:test";
import assert from "node:assert/strict";
import { changePasswordBodySchema, loginBodySchema, pushTokenBodySchema, refreshBodySchema } from "./auth-schemas";

const base = { identifier: "1234567890", password: "Rahasia123", platform: "ANDROID", deviceId: "device-0001" };

test("login: bentuk valid diterima; identifier dipangkas", () => {
  const parsed = loginBodySchema.parse({ ...base, identifier: " 1234567890 " });
  assert.equal(parsed.identifier, "1234567890");
  assert.equal(loginBodySchema.safeParse({ ...base, identifier: "Admin@Contoh.ID", platform: "WEB", deviceId: undefined }).success, true);
});

test("login: kunci tak dikenal ditolak (strictObject)", () => {
  assert.equal(loginBodySchema.safeParse({ ...base, role: "SUPER_ADMIN" }).success, false);
});

test("login: identifier bukan NISN/email ditolak", () => {
  for (const identifier of ["123", "bukan email", "", "0000000000"]) {
    assert.equal(loginBodySchema.safeParse({ ...base, identifier }).success, false, identifier);
  }
});

test("login: password 1..200, platform enum", () => {
  assert.equal(loginBodySchema.safeParse({ ...base, password: "" }).success, false);
  assert.equal(loginBodySchema.safeParse({ ...base, password: "a".repeat(201) }).success, false);
  assert.equal(loginBodySchema.safeParse({ ...base, platform: "DESKTOP" }).success, false);
});

test("login: deviceId pola ^[A-Za-z0-9._:-]{8,100}$, deviceName <= 100", () => {
  assert.equal(loginBodySchema.safeParse({ ...base, deviceId: "short" }).success, false);
  assert.equal(loginBodySchema.safeParse({ ...base, deviceId: "ada spasi di sini" }).success, false);
  assert.equal(loginBodySchema.safeParse({ ...base, deviceId: "abc.DEF_1:2-3" }).success, true);
  assert.equal(loginBodySchema.safeParse({ ...base, deviceName: "x".repeat(101) }).success, false);
});

test("login: expoPushToken harus berformat Expo", () => {
  assert.equal(loginBodySchema.safeParse({ ...base, expoPushToken: "ExponentPushToken[abcdefghij123]" }).success, true);
  assert.equal(loginBodySchema.safeParse({ ...base, expoPushToken: "ExpoPushToken[abcDEF_123-xyz]" }).success, true);
  assert.equal(loginBodySchema.safeParse({ ...base, expoPushToken: "fcm-token-123" }).success, false);
  assert.equal(loginBodySchema.safeParse({ ...base, expoPushToken: "ExpoPushToken[short]" }).success, false);
});

test("refresh, change-password, push-token: strictObject", () => {
  assert.equal(refreshBodySchema.safeParse({ refreshToken: "abc" }).success, true);
  assert.equal(refreshBodySchema.safeParse({ refreshToken: "" }).success, false);
  assert.equal(refreshBodySchema.safeParse({ refreshToken: "abc", extra: 1 }).success, false);
  assert.equal(changePasswordBodySchema.safeParse({ currentPassword: "a", newPassword: "b" }).success, true);
  assert.equal(changePasswordBodySchema.safeParse({ currentPassword: "a" }).success, false);
  assert.equal(pushTokenBodySchema.safeParse({ expoPushToken: "x" }).success, true);
  assert.equal(pushTokenBodySchema.safeParse({ expoPushToken: "x".repeat(256) }).success, false);
});
