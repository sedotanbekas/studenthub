import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoSummary } from "../../src/lib/frontend/demo";
import { notificationsUnasked } from "./browser-env";
import { markSignedIn } from "./session-cookie";

/**
 * Pasang aplikasi (PWA, 2026-10-08): lembar ajakan beranda HP (iPhone = langkah Bagikan; Android = tawaran browser),
 * item menu, tautan di halaman masuk, dan halaman publik /pasang. /api/web di-mock; tawaran pasang Chromium ditiru
 * dengan event beforeinstallprompt sintetis.
 */

const IPHONE = devices["iPhone 13"].userAgent;
const ANDROID = "Mozilla/5.0 (Linux; Android 14; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const ANDROID_INSTAGRAM = "Mozilla/5.0 (Linux; Android 14; SM-A155F Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/140.0.0.0 Mobile Safari/537.36 Instagram 389.0.0.29.81 Android";
const PUBLIC_KEY = "BDHsMb5mUv8hdwi3QYmi_kfIdZ4gftGar1_SefZ9SlslFZcDT_NbsnLFLTczHnrIz9GLRsK-rx7c74Cpmtg0sUc";

const identity = {
  user: { id: "user1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false },
  school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))],
};
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });

async function phone(browser: Browser, userAgent: string): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent });
  return context.newPage();
}

async function signedIn(page: Page): Promise<void> {
  await markSignedIn(page);
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    if (path === "/me/web-push") return route.fulfill({ json: envelope({ enabled: true, publicKey: PUBLIC_KEY, subscribed: false }) });
    if (path === "/notifications/unread-count") return route.fulfill({ json: envelope({ total: 0, announcements: 0, personal: 0, latestCreatedAt: null }) });
    const data = path === "/auth/me" ? identity : path === "/school/dashboard/summary" ? demoSummary : [];
    return route.fulfill({ json: envelope(data, { page: 1, total: 0, limit: 20, totalPages: 0 }) });
  });
}

/** Tawaran pasang Chromium tiruan: dikirim ulang tiap 200 ms sampai prompt() dipanggil (penampung terpasang saat modul dimuat). */
async function offerInstall(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __promptCalls: number };
    w.__promptCalls = 0;
    const timer = setInterval(() => {
      if (w.__promptCalls > 0) { clearInterval(timer); return; }
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.assign(event, { prompt: async () => { w.__promptCalls += 1; }, userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }) });
      window.dispatchEvent(event);
    }, 200);
  });
}

const promptCalls = (page: Page) => page.evaluate(() => (window as unknown as { __promptCalls: number }).__promptCalls);

test("iPhone (tab Safari): lembar Pasang di layar utama + langkah Bagikan; Mengerti menunda, lalu giliran ajakan notifikasi", async ({ browser }) => {
  const page = await phone(browser, IPHONE);
  await notificationsUnasked(page);
  await signedIn(page);
  await page.goto("/hub");
  const sheet = page.getByRole("dialog", { name: "Pasang di layar utama" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText("tanpa App Store");
  await expect(sheet).toContainText("Tambah ke Layar Utama");
  await expect(sheet.getByRole("button", { name: "Mengerti" })).toBeFocused();
  await expect(page.getByRole("dialog", { name: "Aktifkan notifikasi" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Mengerti" }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(page.getByRole("dialog", { name: "Aktifkan notifikasi" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("dialog", { name: "Pasang di layar utama" })).toHaveCount(0);
  await page.context().close();
});

test("Android: tawaran browser -> lembar Pasang aplikasi; Pasang memanggil prompt asli sekali", async ({ browser }) => {
  const page = await phone(browser, ANDROID);
  await offerInstall(page);
  await signedIn(page);
  await page.goto("/hub");
  const sheet = page.getByRole("dialog", { name: "Pasang aplikasi" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText("tanpa Play Store");
  await sheet.getByRole("button", { name: "Pasang" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Aplikasi sedang dipasang" })).toBeVisible();
  expect(await promptCalls(page)).toBe(1);
  await expect(sheet).toBeHidden();
  await page.context().close();
});

test("Menu HP: item Pasang aplikasi membuka langkah (Android tanpa tawaran) + tautan halaman pasang", async ({ browser }) => {
  const page = await phone(browser, ANDROID);
  await signedIn(page);
  await page.goto("/hub");
  await page.getByRole("button", { name: "Menu, buka navigasi" }).click();
  await page.getByRole("button", { name: /Pasang aplikasi/ }).click();
  const dialog = page.getByRole("dialog", { name: "Pasang aplikasi" });
  await expect(dialog).toContainText("Instal aplikasi");
  await expect(dialog.getByRole("link", { name: /Halaman pasang/ })).toHaveAttribute("href", "/pasang");
  await dialog.getByRole("button", { name: "Mengerti" }).click();
  await expect(dialog).toBeHidden();
  await page.context().close();
});

test("desktop tanpa tawaran pasang: tanpa item menu & tanpa lembar ajakan", async ({ page }) => {
  await signedIn(page);
  await page.goto("/hub");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.getByRole("button", { name: /Pasang aplikasi/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /Pasang/ })).toHaveCount(0);
});

test("halaman masuk (iPhone): tautan Pasang aplikasi di HP -> /pasang dengan langkah iPhone, QR, dan bagikan WhatsApp", async ({ browser }) => {
  const page = await phone(browser, IPHONE);
  await page.goto("/hub");
  await page.getByRole("link", { name: "Pasang aplikasi di HP" }).click();
  await expect(page).toHaveURL(/\/pasang$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(/^Pasang /);
  await expect(page.locator(".install-action")).toContainText("Tambah ke Layar Utama");
  await expect(page.locator(".install-qr svg")).toBeVisible();
  await expect(page.getByRole("link", { name: "Kirim lewat WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=Pasang%20aplikasi%20/);
  await page.context().close();
});

test("/pasang: Android dengan tawaran -> Pasang sekarang; di dalam Instagram -> Buka di Chrome dulu", async ({ browser }) => {
  const android = await phone(browser, ANDROID);
  await offerInstall(android);
  await android.goto("/pasang");
  await android.getByRole("button", { name: "Pasang sekarang" }).click();
  await expect(android.getByRole("status")).toHaveText("Aplikasi sedang dipasang. Ikonnya muncul di layar utama.");
  await android.context().close();
  const inApp = await phone(browser, ANDROID_INSTAGRAM);
  await inApp.goto("/pasang");
  await expect(inApp.locator(".install-action")).toContainText("Buka di Chrome");
  await inApp.context().close();
});
