import { test } from "node:test";
import assert from "node:assert/strict";
import { describeUserAgent, deviceSummary, failureCodeOf, shouldRecordLogin } from "./rules";

const WINDOWS_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_REDUCED = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test("shouldRecordLogin: hanya super admin yang dipantau", () => {
  assert.equal(shouldRecordLogin("SUPER_ADMIN"), true);
  for (const role of ["SCHOOL_ADMIN", "SPONSOR", "STUDENT"] as const) assert.equal(shouldRecordLogin(role), false, role);
});

test("describeUserAgent: browser versi mayor, OS, jenis & model perangkat", () => {
  assert.deepEqual(describeUserAgent(WINDOWS_CHROME), { deviceType: "DESKTOP", browser: "Chrome 141", os: "Windows 10/11", deviceModel: null });
  assert.deepEqual(describeUserAgent(IPHONE_SAFARI), { deviceType: "MOBILE", browser: "Safari 18", os: "iOS 18.6", deviceModel: "Apple iPhone" });
  assert.deepEqual(describeUserAgent(ANDROID_CHROME), { deviceType: "MOBILE", browser: "Chrome 140", os: "Android 14", deviceModel: "SM-A546E" });
  assert.deepEqual(describeUserAgent(MAC_SAFARI), { deviceType: "DESKTOP", browser: "Safari 18", os: "macOS", deviceModel: "Apple" });
  assert.deepEqual(describeUserAgent(IPAD), { deviceType: "TABLET", browser: "Safari 17", os: "iOS 17.0", deviceModel: "Apple iPad" });
});

test("describeUserAgent: model 'K' (user-agent tereduksi Chrome) bukan model; UA kosong/aneh -> semua null", () => {
  assert.equal(describeUserAgent(ANDROID_REDUCED).deviceModel, null);
  const unknown = { deviceType: null, browser: null, os: null, deviceModel: null };
  assert.deepEqual(describeUserAgent(null), unknown);
  assert.deepEqual(describeUserAgent(""), unknown);
  assert.deepEqual(describeUserAgent("okhttp/4.12.0"), unknown);
});

test("deviceSummary: ringkasan Bahasa Indonesia untuk tabel riwayat", () => {
  const web = { platform: "WEB" as const, deviceName: "studenthub.id Web" };
  assert.equal(deviceSummary({ ...web, ...describeUserAgent(WINDOWS_CHROME) }), "Chrome 141 · Windows 10/11 · Komputer");
  assert.equal(deviceSummary({ ...web, ...describeUserAgent(IPHONE_SAFARI) }), "Safari 18 · iOS 18.6 · Apple iPhone");
  const app = { platform: "ANDROID" as const, deviceName: "Samsung A54", ...describeUserAgent("okhttp/4.12.0") };
  assert.equal(deviceSummary(app), "Aplikasi Android · Samsung A54");
  assert.equal(deviceSummary({ platform: "WEB", deviceName: null, ...describeUserAgent(null) }), "Perangkat tidak dikenal");
});

test("failureCodeOf: kode galat login -> kode kegagalan riwayat", () => {
  assert.equal(failureCodeOf("INVALID_CREDENTIALS"), "WRONG_PASSWORD");
  assert.equal(failureCodeOf("WRONG_PASSWORD"), "WRONG_PASSWORD", "kode tersimpan dibaca ulang apa adanya");
  for (const code of ["TOTP_INVALID", "ACCOUNT_INACTIVE", "TEMP_PASSWORD_EXPIRED"]) assert.equal(failureCodeOf(code), code);
  assert.equal(failureCodeOf("TOTP_REQUIRED"), null, "permintaan kode TOTP bukan percobaan gagal");
  assert.equal(failureCodeOf("RATE_LIMITED"), "OTHER");
  assert.equal(failureCodeOf(null), "OTHER");
});
