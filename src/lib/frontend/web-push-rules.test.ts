import { test } from "node:test";
import assert from "node:assert/strict";
import {
  navigationKind,
  appBadgeAction,
  base64UrlToBytes,
  blockedHelpSteps,
  deviceInfoOf,
  feedbackText,
  isPromptDeferred,
  promptDeferValue,
  promptModeOf,
  promptText,
  sameServerKey,
  syncAction,
  type DeviceInfo,
  type PromptInput,
} from "./web-push-rules";

const IPHONE_16_4 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1";
const IPHONE_15 = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";
const IPADOS = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const env = (extra: Partial<{ maxTouchPoints: number; standalone: boolean; coarse: boolean; width: number }> = {}) => ({ maxTouchPoints: 0, standalone: false, coarse: false, width: 1280, ...extra });

test("deviceInfoOf: iPhone, iPadOS (Macintosh + sentuh), Android, desktop", () => {
  assert.deepEqual(deviceInfoOf(IPHONE_16_4, env({ maxTouchPoints: 5, coarse: true, width: 390 })), { ios: true, iosVersion: 16.04, android: false, mobile: true, standalone: false });
  assert.equal(deviceInfoOf(IPADOS, env({ maxTouchPoints: 5 })).ios, true);
  assert.equal(deviceInfoOf(IPADOS, env()).ios, false, "Mac sungguhan");
  assert.equal(deviceInfoOf(ANDROID, env()).android, true);
  assert.equal(deviceInfoOf(DESKTOP, env()).mobile, false);
  assert.equal(deviceInfoOf(DESKTOP, env({ coarse: true, width: 600 })).mobile, true, "tablet layar sentuh sempit");
});

const phone: DeviceInfo = deviceInfoOf(ANDROID, env({ coarse: true, width: 400 }));
const base: PromptInput = { enabled: true, demo: false, restricted: false, deferred: false, home: true, dialogOpen: false, supported: true, permission: "default", device: phone };

test("promptModeOf: hanya di beranda HP/aplikasi, tanpa dialog lain; diblokir & sudah diizinkan tidak otomatis", () => {
  assert.equal(promptModeOf(base), "ask");
  for (const off of [{ demo: true }, { restricted: true }, { enabled: false }, { deferred: true }, { home: false }, { dialogOpen: true }, { permission: "granted" as const }, { permission: "denied" as const }]) {
    assert.equal(promptModeOf({ ...base, ...off }), null, JSON.stringify(off));
  }
  assert.equal(promptModeOf({ ...base, device: deviceInfoOf(DESKTOP, env()) }), null, "desktop tidak otomatis");
  assert.equal(promptModeOf({ ...base, device: { ...deviceInfoOf(DESKTOP, env()), standalone: true } }), "ask", "aplikasi terpasang di desktop");
});

test("promptModeOf: iPhone di tab Safari -> pasang ke layar utama dulu (hanya iOS 16.4+)", () => {
  const iphone = deviceInfoOf(IPHONE_16_4, env({ maxTouchPoints: 5, coarse: true, width: 390 }));
  assert.equal(promptModeOf({ ...base, supported: false, permission: "unsupported", device: iphone }), "install-ios");
  assert.equal(promptModeOf({ ...base, supported: false, permission: "unsupported", device: deviceInfoOf(IPHONE_15, env({ maxTouchPoints: 5 })) }), null, "iOS lama tidak bisa sama sekali");
  assert.equal(promptModeOf({ ...base, supported: false, permission: "unsupported", device: { ...iphone, standalone: true } }), null);
  assert.equal(promptModeOf({ ...base, supported: false, permission: "unsupported" }), null, "Android tanpa dukungan");
});

test("penundaan 7 hari di perangkat", () => {
  const now = Date.UTC(2026, 9, 3);
  assert.equal(isPromptDeferred(null, now), false);
  assert.equal(isPromptDeferred("bukan angka", now), false);
  const value = promptDeferValue(now);
  assert.equal(isPromptDeferred(value, now + 6 * 86_400_000), true);
  assert.equal(isPromptDeferred(value, now + 7 * 86_400_000), false);
});

test("teks: per peran & per jenis perangkat; langkah buka blokir per platform", () => {
  assert.equal(promptText("STUDENT", phone), "Kabar absen, tagihan, dan pengumuman langsung muncul di HP-mu walau aplikasi tertutup.");
  assert.match(promptText("SCHOOL_ADMIN", deviceInfoOf(DESKTOP, env())), /perangkat ini/);
  assert.equal(feedbackText("on", phone), "Notifikasi aktif. Kabar baru muncul di HP ini.");
  assert.equal(feedbackText("on", deviceInfoOf(DESKTOP, env())), "Notifikasi aktif. Kabar baru muncul di perangkat ini.");
  assert.match(feedbackText("failed", deviceInfoOf(DESKTOP, env())), /^Perangkat ini belum bisa/);
  assert.match(blockedHelpSteps(deviceInfoOf(IPHONE_16_4, env({ maxTouchPoints: 5 })))[0]!, /Pengaturan iPhone/);
  assert.match(blockedHelpSteps(phone)[1]!, /Izin/);
  assert.equal(blockedHelpSteps(deviceInfoOf(DESKTOP, env())).length, 3);
});

test("kunci server: base64url -> byte, bandingkan dengan langganan", () => {
  const bytes = base64UrlToBytes("BAEC_-8");
  assert.deepEqual([...bytes], [4, 1, 2, 255, 239]);
  assert.equal(sameServerKey(bytes.buffer as ArrayBuffer, bytes), true);
  assert.equal(sameServerKey(new Uint8Array([4, 1]).buffer as ArrayBuffer, bytes), false);
  assert.equal(sameServerKey(null, bytes), false);
});

test("syncAction: diputuskan server per identitas", () => {
  const s = { enabled: true, supported: true, permission: "granted" as const, subscribed: true, hasBrowserSubscription: true, keyMatches: true };
  assert.equal(syncAction(s), "none");
  assert.equal(syncAction({ ...s, subscribed: false }), "resubscribe", "masuk ulang: sesi baru tanpa baris");
  assert.equal(syncAction({ ...s, keyMatches: false }), "resubscribe");
  assert.equal(syncAction({ ...s, hasBrowserSubscription: false }), "subscribe");
  assert.equal(syncAction({ ...s, permission: "default" }), "none");
  assert.equal(syncAction({ ...s, enabled: false, hasBrowserSubscription: false }), "none");
});

test("appBadgeAction: ikut jumlah belum dibaca bila diizinkan", () => {
  const ok = { supported: true, permission: "granted" as const };
  assert.deepEqual(appBadgeAction(5, ok), { kind: "set", count: 5 });
  assert.deepEqual(appBadgeAction(0, ok), { kind: "clear" });
  assert.equal(appBadgeAction(null, ok), null);
  assert.equal(appBadgeAction(5, { ...ok, permission: "default" }), null);
  assert.equal(appBadgeAction(5, { ...ok, supported: false }), null);
});

test("navigationKind: tujuan di halaman yang sama -> muat penuh (?notif= & ?absen=1 diproses saat pasang); halaman lain -> router", () => {
  assert.equal(navigationKind("/hub/my-attendance", "/hub/my-attendance?absen=1&notif=n1"), "reload");
  assert.equal(navigationKind("/hub/billing", "/hub/billing?notif=n2"), "reload");
  assert.equal(navigationKind("/hub/notifications", "/hub/my-attendance?absen=1&notif=n1"), "push");
  assert.equal(navigationKind("/hub", "/hub/billing"), "push");
});
