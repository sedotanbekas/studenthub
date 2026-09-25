import { test } from "node:test";
import assert from "node:assert/strict";
import { canCheckInFromSession, decideDeviceBinding, isMobileBrowserAgent, isMobilePlatform, planLoginRevocations, requiresDeviceId, sessionDeviceId, type LiveSessionView } from "./device";

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

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

test("isMobileBrowserAgent: browser HP ya, desktop / kosong tidak", () => {
  assert.equal(isMobileBrowserAgent(ANDROID_CHROME), true);
  assert.equal(isMobileBrowserAgent(IPHONE_SAFARI), true);
  assert.equal(isMobileBrowserAgent(DESKTOP_CHROME), false);
  assert.equal(isMobileBrowserAgent(""), false);
  assert.equal(isMobileBrowserAgent(null), false);
});

test("canCheckInFromSession: app ber-deviceId atau browser HP ber-deviceId", () => {
  assert.equal(canCheckInFromSession({ platform: "ANDROID", deviceId: "dev-hp-0001", userAgent: null }), true);
  assert.equal(canCheckInFromSession({ platform: "ANDROID", deviceId: null, userAgent: ANDROID_CHROME }), false);
  assert.equal(canCheckInFromSession({ platform: "WEB", deviceId: "web-0001-abcd", userAgent: ANDROID_CHROME }), true);
  assert.equal(canCheckInFromSession({ platform: "WEB", deviceId: "web-0001-abcd", userAgent: DESKTOP_CHROME }), false);
  assert.equal(canCheckInFromSession({ platform: "WEB", deviceId: null, userAgent: IPHONE_SAFARI }), false);
});

test("siswa login dari browser HP dengan deviceId = perangkat absen: mencabut sesi app & web-HP lain", () => {
  const live = [
    session("hp", { platform: "ANDROID", deviceId: "dev-hp-0001" }),
    session("webhp", { platform: "WEB", deviceId: "web-old-0001" }),
    session("laptop", { platform: "WEB", deviceId: null }),
  ];
  const plan = planLoginRevocations({ role: "STUDENT", platform: "WEB", deviceId: "web-new-0001", userAgent: ANDROID_CHROME, liveSessions: live });
  assert.deepEqual([...plan].sort(), ["hp", "webhp"]);
});

test("siswa login web desktop dengan deviceId bukan perangkat absen: tidak mencabut berdasarkan perangkat", () => {
  const live = [session("hp", { platform: "ANDROID", deviceId: "dev-hp-0001" })];
  const plan = planLoginRevocations({ role: "STUDENT", platform: "WEB", deviceId: "web-new-0001", userAgent: DESKTOP_CHROME, liveSessions: live });
  assert.deepEqual(plan, []);
});

test("decideDeviceBinding: browser HP ber-deviceId diikat; browser desktop tidak", () => {
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: "dev-hp-0001" }, "WEB", "web-new-0001", ANDROID_CHROME), { bind: true, deviceId: "web-new-0001" });
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: null }, "WEB", "web-new-0001", DESKTOP_CHROME), { bind: false });
  assert.deepEqual(decideDeviceBinding({ boundDeviceId: "web-new-0001" }, "WEB", "web-new-0001", IPHONE_SAFARI), { bind: false });
});

test("sessionDeviceId: deviceId login WEB hanya disimpan dari browser HP; app mobile apa adanya", () => {
  assert.equal(sessionDeviceId("WEB", "web-0001-abcd", ANDROID_CHROME), "web-0001-abcd");
  assert.equal(sessionDeviceId("WEB", "web-0001-abcd", DESKTOP_CHROME), null);
  assert.equal(sessionDeviceId("WEB", "web-0001-abcd", null), null);
  assert.equal(sessionDeviceId("ANDROID", "dev-hp-0001", null), "dev-hp-0001");
  assert.equal(sessionDeviceId("IOS", null, IPHONE_SAFARI), null);
});
