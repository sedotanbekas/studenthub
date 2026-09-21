import { test } from "node:test";
import assert from "node:assert/strict";
import { decideDeviceBinding, isMobilePlatform, planLoginRevocations, requiresDeviceId, type LiveSessionView } from "./device";

const T0 = new Date("2026-09-01T00:00:00.000Z").getTime();
const session = (id: string, over: Partial<LiveSessionView> = {}): LiveSessionView => ({
  id,
  platform: "WEB",
  deviceId: null,
  lastUsedAt: new Date(T0),
  createdAt: new Date(T0),
  ...over,
});
const minutes = (n: number): Date => new Date(T0 + n * 60_000);

test("isMobilePlatform & requiresDeviceId (hanya siswa di ANDROID/IOS)", () => {
  assert.equal(isMobilePlatform("ANDROID"), true);
  assert.equal(isMobilePlatform("WEB"), false);
  assert.equal(requiresDeviceId("STUDENT", "IOS"), true);
  assert.equal(requiresDeviceId("STUDENT", "WEB"), false);
  assert.equal(requiresDeviceId("SCHOOL_ADMIN", "ANDROID"), false);
});

test("tanpa sesi hidup -> tidak ada yang dicabut", () => {
  assert.deepEqual(planLoginRevocations({ role: "SCHOOL_ADMIN", platform: "WEB", deviceId: null, liveSessions: [] }), []);
});

test("login mobile mencabut sesi milik sendiri pada deviceId yang sama", () => {
  const live = [session("a", { platform: "ANDROID", deviceId: "dev-aaaa-1" }), session("b", { platform: "ANDROID", deviceId: "dev-bbbb-2" })];
  const plan = planLoginRevocations({ role: "SCHOOL_ADMIN", platform: "ANDROID", deviceId: "dev-aaaa-1", liveSessions: live });
  assert.deepEqual(plan, ["a"]);
});

test("login web dengan deviceId tidak mencabut berdasarkan perangkat", () => {
  const live = [session("a", { platform: "ANDROID", deviceId: "dev-aaaa-1" })];
  assert.deepEqual(planLoginRevocations({ role: "SCHOOL_ADMIN", platform: "WEB", deviceId: "dev-aaaa-1", liveSessions: live }), []);
});

test("siswa login mobile mencabut SEMUA sesi mobile lain; sesi web dibiarkan", () => {
  const live = [
    session("hp1", { platform: "ANDROID", deviceId: "dev-hp-0001" }),
    session("hp2", { platform: "IOS", deviceId: "dev-hp-0002" }),
    session("web", { platform: "WEB" }),
  ];
  const plan = planLoginRevocations({ role: "STUDENT", platform: "ANDROID", deviceId: "dev-hp-0003", liveSessions: live });
  assert.deepEqual([...plan].sort(), ["hp1", "hp2"]);
});

test("siswa login web: batas 2 sesi mengusir yang paling lama tidak dipakai", () => {
  const live = [
    session("hp", { platform: "ANDROID", deviceId: "dev-hp-0001", lastUsedAt: minutes(10) }),
    session("web1", { platform: "WEB", lastUsedAt: minutes(5) }),
  ];
  assert.deepEqual(planLoginRevocations({ role: "STUDENT", platform: "WEB", deviceId: null, liveSessions: live }), ["web1"]);
});

test("batas per peran: super admin maks 3 -> sesi ke-4 mengusir yang tertua (lastUsedAt, lalu createdAt)", () => {
  const live = [
    session("s1", { lastUsedAt: minutes(3), createdAt: minutes(1) }),
    session("s2", { lastUsedAt: minutes(1), createdAt: minutes(2) }),
    session("s3", { lastUsedAt: minutes(1), createdAt: minutes(0) }),
  ];
  assert.deepEqual(planLoginRevocations({ role: "SUPER_ADMIN", platform: "WEB", deviceId: null, liveSessions: live }), ["s3"]);
});

test("pengusiran dihitung SETELAH pencabutan perangkat (tidak mencabut berlebihan)", () => {
  const live = [
    session("same", { platform: "IOS", deviceId: "dev-same-01", lastUsedAt: minutes(9) }),
    session("w1", { lastUsedAt: minutes(1) }),
    session("w2", { lastUsedAt: minutes(2) }),
  ];
  const plan = planLoginRevocations({ role: "SUPER_ADMIN", platform: "IOS", deviceId: "dev-same-01", liveSessions: live });
  assert.deepEqual(plan, ["same"]);
});

test("batas dapat dioverride; sisa melebihi batas dikurangi sampai muat sesi baru", () => {
  const live = [session("x1", { lastUsedAt: minutes(1) }), session("x2", { lastUsedAt: minutes(2) }), session("x3", { lastUsedAt: minutes(3) })];
  const plan = planLoginRevocations({ role: "SPONSOR", platform: "WEB", deviceId: null, liveSessions: live, maxActive: 2 });
  assert.deepEqual(plan, ["x1", "x2"]);
});

test("decideDeviceBinding: ikat bila berbeda dari perangkat terikat, selain itu tidak", () => {
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: null }, "ANDROID", "dev-new-0001"), { bind: true, deviceId: "dev-new-0001" });
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: "dev-old-0001" }, "IOS", "dev-new-0001"), { bind: true, deviceId: "dev-new-0001" });
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: "dev-same-001" }, "ANDROID", "dev-same-001"), { bind: false });
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: null }, "WEB", "dev-new-0001"), { bind: false });
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: null }, "ANDROID", null), { bind: false });
});
