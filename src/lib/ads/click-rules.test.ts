import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyClick, isNewStudent, mapDeviceType, type ClickFacts } from "./click-rules";
import { clickBody } from "./schemas";

const NOW = new Date("2026-09-21T03:00:00.000Z");
const DAY = 86_400_000;
const base: ClickFacts = { running: true, billedToday: false, recentImpression: true, newStudent: false, balance: 1_000, cpc: 500 };

test("klik pertama berimpresi dengan saldo cukup ditagih; saldo tepat CPC tetap ditagih", () => {
  assert.equal(classifyClick(base), "CHARGED");
  assert.equal(classifyClick({ ...base, balance: 500 }), "CHARGED");
});

test("urutan keputusan: AD_NOT_LIVE > DUPLICATE > SUSPECT > INSUFFICIENT_BALANCE", () => {
  assert.equal(classifyClick({ ...base, running: false, billedToday: true, recentImpression: false, balance: 0 }), "AD_NOT_LIVE");
  assert.equal(classifyClick({ ...base, billedToday: true, recentImpression: false, balance: 0 }), "DUPLICATE");
  assert.equal(classifyClick({ ...base, billedToday: true }), "DUPLICATE", "duplikat walau saldo cukup");
  assert.equal(classifyClick({ ...base, recentImpression: false, balance: 0 }), "SUSPECT");
  assert.equal(classifyClick({ ...base, newStudent: true }), "SUSPECT");
  assert.equal(classifyClick({ ...base, balance: 499 }), "INSUFFICIENT_BALANCE");
});

test("siswa baru: aktif < 7 hari atau belum pernah aktif", () => {
  assert.equal(isNewStudent(null, NOW), true);
  assert.equal(isNewStudent(new Date(NOW.getTime() - 7 * DAY + 1), NOW), true);
  assert.equal(isNewStudent(new Date(NOW.getTime() - 7 * DAY), NOW), false);
  assert.equal(isNewStudent(new Date(NOW.getTime() - 30 * DAY), NOW), false);
});

test("mapDeviceType: nilai expo-device dinormalisasi ke enum DeviceType", () => {
  assert.equal(mapDeviceType("PHONE"), "MOBILE");
  assert.equal(mapDeviceType("TABLET"), "TABLET");
  assert.equal(mapDeviceType("DESKTOP"), "DESKTOP");
  assert.equal(mapDeviceType("TV"), "DESKTOP");
  assert.equal(mapDeviceType("UNKNOWN"), "MOBILE");
  assert.equal(mapDeviceType("MOBILE"), "MOBILE");
});

test("clickBody menerima deviceType PHONE dari expo-device dan menormalkannya", () => {
  const token = "x".repeat(40);
  assert.equal(clickBody.parse({ token, deviceType: "PHONE" }).deviceType, "MOBILE");
  assert.equal(clickBody.parse({ token }).deviceType, "MOBILE");
  assert.equal(clickBody.safeParse({ token, deviceType: "FRIDGE" }).success, false);
});
