import { test } from "node:test";
import assert from "node:assert/strict";
import { installDeferValue, installIntro, installModeOf, installPageUrl, installShareText, installSheetDelayMs, installSheetOf, installSteps, menuInstallVisible, whatsappShareUrl, type InstallMode, type InstallSheetInput } from "./install-rules";
import { deviceInfoOf, isPromptDeferred } from "./web-push-rules";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1";
const IPHONE_EDGE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 EdgiOS/138.0.3351.65 Mobile/15E148 Safari/605.1.15";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15";
const IPHONE_INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 389.0.0.29.81 (iPhone15,2; iOS 18_5; id_ID; id; scale=3.00; 1179x2556; 754339213)";
const IPHONE_FACEBOOK = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/512.0.0.41.106;FBBV/739483251;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/18.5;FBSS/3;FBID/phone;FBLC/id_ID;FBOP/5]";
const IPHONE_GOOGLE_APP = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/380.0.788455542 Mobile/15E148 Safari/604.1";
const IPHONE_WKWEBVIEW = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const IPHONE_WECHAT = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50(0x18003237) NetType/WIFI Language/id";
const IPADOS_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_WEBVIEW = "Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_INSTAGRAM = `${ANDROID_WEBVIEW} Instagram 389.0.0.29.81 Android (34/14; 450dpi; 1080x2340; samsung; SM-A155F; a15; mt6789; id_ID; 754339213)`;
const ANDROID_TIKTOK = "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 musical_ly_2024001020 BytedanceWebview/d8a21c6";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const PHONE_ENV = { maxTouchPoints: 5, standalone: false, coarse: true, width: 390 };
const DESKTOP_ENV = { maxTouchPoints: 0, standalone: false, coarse: false, width: 1440 };

function modeOf(ua: string, extra: { canPrompt?: boolean; installed?: boolean; standalone?: boolean; desktop?: boolean } = {}): InstallMode {
  const device = deviceInfoOf(ua, { ...(extra.desktop ? DESKTOP_ENV : PHONE_ENV), standalone: extra.standalone ?? false });
  return installModeOf({ ua, device, canPrompt: extra.canPrompt ?? false, installed: extra.installed ?? false });
}

test("installModeOf: dibuka dari ikon layar utama atau baru saja dipasang -> installed", () => {
  assert.equal(modeOf(IPHONE_SAFARI, { standalone: true }), "installed");
  assert.equal(modeOf(ANDROID_CHROME, { standalone: true, canPrompt: true }), "installed");
  assert.equal(modeOf(ANDROID_CHROME, { installed: true }), "installed", "appinstalled di halaman ini");
});

test("installModeOf: browser yang menawarkan pasang (beforeinstallprompt) -> prompt, di HP maupun komputer", () => {
  assert.equal(modeOf(ANDROID_CHROME, { canPrompt: true }), "prompt");
  assert.equal(modeOf(DESKTOP_CHROME, { canPrompt: true, desktop: true }), "prompt");
});

test("installModeOf: iPhone/iPad — Safari vs browser lain (keduanya lewat Bagikan -> Tambah ke Layar Utama)", () => {
  assert.equal(modeOf(IPHONE_SAFARI), "ios-safari");
  assert.equal(modeOf(IPADOS_SAFARI), "ios-safari", "iPadOS menyamar sebagai Mac");
  for (const ua of [IPHONE_CHROME, IPHONE_EDGE, IPHONE_FIREFOX]) assert.equal(modeOf(ua), "ios-browser", ua);
});

test("installModeOf: browser di dalam aplikasi lain (Instagram, Facebook, Google, TikTok, WebView) -> buka di browser dulu", () => {
  for (const ua of [IPHONE_INSTAGRAM, IPHONE_FACEBOOK, IPHONE_GOOGLE_APP, IPHONE_WECHAT]) assert.equal(modeOf(ua), "ios-in-app", ua);
  assert.equal(modeOf(IPHONE_WKWEBVIEW), "ios-in-app", "WebView aplikasi lain (mis. WhatsApp/Gmail) tanpa token Safari/");
  assert.equal(modeOf(IPHONE_WKWEBVIEW, { standalone: true }), "installed", "aplikasi layar utama juga tanpa token Safari/");
  for (const ua of [ANDROID_WEBVIEW, ANDROID_INSTAGRAM, ANDROID_TIKTOK]) assert.equal(modeOf(ua), "android-in-app", ua);
});

test("installModeOf: Android tanpa tawaran pasang -> lewat menu browser; komputer tanpa tawaran -> desktop", () => {
  assert.equal(modeOf(ANDROID_CHROME), "android-menu");
  assert.equal(modeOf(DESKTOP_CHROME, { desktop: true }), "desktop");
});

test("installSteps: langkah manual per mode; mode tombol/terpasang/komputer tanpa langkah", () => {
  for (const mode of ["prompt", "installed", "desktop"] as const) assert.deepEqual(installSteps(mode), [], mode);
  for (const mode of ["ios-safari", "ios-browser", "ios-in-app", "android-in-app", "android-menu"] as const) assert.ok(installSteps(mode).length >= 3, mode);
  const safari = installSteps("ios-safari").join(" ");
  assert.match(safari, /Bagikan/);
  assert.match(safari, /•••/, "iOS 26: tombol Bagikan ada di balik •••");
  assert.match(safari, /Tambah ke Layar Utama/);
  assert.match(installSteps("ios-browser").join(" "), /Safari/, "cadangan bila browser lain tidak punya pilihan itu");
  assert.match(installSteps("ios-in-app").join(" "), /Buka di Safari/);
  assert.match(installSteps("android-in-app").join(" "), /Buka di Chrome/);
  assert.match(installSteps("android-menu").join(" "), /Instal aplikasi/);
});

test("installIntro: kalimat pembuka per mode — tanpa toko aplikasi / berkas APK, iPhone lewat Bagikan", () => {
  const modes: InstallMode[] = ["installed", "prompt", "ios-safari", "ios-browser", "ios-in-app", "android-in-app", "android-menu", "desktop"];
  for (const mode of modes) assert.ok(installIntro(mode).length > 20, mode);
  assert.match(installIntro("prompt"), /tanpa Play Store/);
  assert.match(installIntro("android-menu"), /APK/);
  assert.match(installIntro("ios-safari"), /App Store/);
  assert.match(installIntro("ios-safari"), /notifikasi/i, "syarat Web Push iPhone");
  assert.match(installIntro("installed"), /sudah terpasang/);
  assert.match(installIntro("desktop"), /kode QR/);
});

const sheetBase: InstallSheetInput = { demo: false, restricted: false, home: true, dialogOpen: false, deferred: false, mobile: true, mode: "prompt" };

test("installSheetOf: lembar otomatis hanya di beranda HP, untuk tombol pasang atau langkah iPhone", () => {
  assert.equal(installSheetOf(sheetBase), "prompt");
  assert.equal(installSheetOf({ ...sheetBase, mode: "ios-safari" }), "ios");
  assert.equal(installSheetOf({ ...sheetBase, mode: "ios-browser" }), "ios");
  for (const mode of ["installed", "ios-in-app", "android-in-app", "android-menu", "desktop"] as const) assert.equal(installSheetOf({ ...sheetBase, mode }), null, mode);
  for (const off of [{ demo: true }, { restricted: true }, { home: false }, { dialogOpen: true }, { deferred: true }, { mobile: false }]) {
    assert.equal(installSheetOf({ ...sheetBase, ...off }), null, JSON.stringify(off));
  }
});

test("installSheetDelayMs: Android yang belum ditawari browser ditunggu lebih lama (tawaran bisa datang belakangan)", () => {
  assert.equal(installSheetDelayMs("android-menu"), 5000);
  for (const mode of ["prompt", "ios-safari", "ios-browser", "installed", "desktop", "ios-in-app", "android-in-app"] as const) assert.equal(installSheetDelayMs(mode), 1500, mode);
});

test("menuInstallVisible: menu Pasang aplikasi disembunyikan bila terpasang, belum terdeteksi, atau komputer tanpa tawaran", () => {
  assert.equal(menuInstallVisible(null), false);
  for (const mode of ["installed", "desktop"] as const) assert.equal(menuInstallVisible(mode), false, mode);
  for (const mode of ["prompt", "ios-safari", "ios-browser", "ios-in-app", "android-in-app", "android-menu"] as const) assert.equal(menuInstallVisible(mode), true, mode);
});

test("halaman /pasang: URL dari APP_ORIGIN, teks & tautan bagikan WhatsApp", () => {
  assert.equal(installPageUrl("https://studenthub.id"), "https://studenthub.id/pasang");
  assert.equal(installPageUrl("https://staging.studenthub.id///"), "https://staging.studenthub.id/pasang");
  const text = installShareText("Student Hub", "https://studenthub.id/pasang");
  assert.equal(text, "Pasang aplikasi Student Hub di HP (Android & iPhone): https://studenthub.id/pasang");
  assert.equal(whatsappShareUrl("a & b?"), "https://wa.me/?text=a%20%26%20b%3F");
});

test("installDeferValue: tunda N hari, dibaca isPromptDeferred", () => {
  const now = Date.UTC(2026, 9, 8);
  const week = installDeferValue(now, 7);
  assert.equal(isPromptDeferred(week, now + 6 * 86_400_000), true);
  assert.equal(isPromptDeferred(week, now + 7 * 86_400_000), false);
  assert.equal(isPromptDeferred(installDeferValue(now, 180), now + 179 * 86_400_000), true);
});
