import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoSummary } from "../../src/lib/frontend/demo";
import { notificationsUnasked } from "./browser-env";
import { markSignedIn } from "./session-cookie";

/**
 * Notifikasi HP (N3): kartu "Notifikasi di perangkat ini" (demo), lembar ajakan di beranda HP + "Nanti saja" 7 hari,
 * dan klik notifikasi (?notif=) yang menandai dibaca lalu membuang parameternya. /api/web di-mock.
 */

const identity = {
  user: { id: "user1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false },
  school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))],
};
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });
const PUBLIC_KEY = "BDHsMb5mUv8hdwi3QYmi_kfIdZ4gftGar1_SefZ9SlslFZcDT_NbsnLFLTczHnrIz9GLRsK-rx7c74Cpmtg0sUc";

async function signedIn(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await markSignedIn(page);
  await page.route("**/api/web/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/web", "");
    calls.push(`${request.method()} ${path}`);
    if (path === "/me/web-push") return route.fulfill({ json: envelope({ enabled: true, publicKey: PUBLIC_KEY, subscribed: false }) });
    if (/^\/notifications\/[^/]+\/read$/.test(path)) return route.fulfill({ json: envelope({ id: "n1", readAt: new Date().toISOString() }) });
    if (path === "/notifications/unread-count") return route.fulfill({ json: envelope({ total: 0, announcements: 0, personal: 0, latestCreatedAt: null }) });
    const data = path === "/auth/me" ? identity : path === "/school/dashboard/summary" ? demoSummary : [];
    return route.fulfill({ json: envelope(data, { page: 1, total: 0, limit: 20, totalPages: 0 }) });
  });
  return calls;
}

test("demo: kartu Notifikasi di perangkat ini di Keamanan akun; Aktifkan menampilkan pesan demo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await page.goto("/hub/security");
  const card = page.locator(".security-card", { hasText: "Notifikasi di perangkat ini" });
  await expect(card).toContainText("Belum aktif.");
  await card.getByRole("button", { name: "Aktifkan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mode demo" })).toBeVisible();
});

test("HP: lembar ajakan muncul di beranda; Nanti saja menunda (tidak muncul lagi setelah dimuat ulang)", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36" });
  const page = await context.newPage();
  await notificationsUnasked(page);
  await signedIn(page);
  await page.goto("/hub");
  const sheet = page.getByRole("dialog", { name: "Aktifkan notifikasi" });
  await expect(sheet).toBeVisible({ timeout: 15_000 });
  await expect(sheet).toContainText("Pengajuan izin, bukti bayar, dan kabar sekolah langsung muncul di HP-mu walau aplikasi tertutup.");
  await expect(sheet.getByRole("button", { name: "Aktifkan" })).toBeFocused();
  await sheet.getByRole("button", { name: "Nanti saja" }).click();
  await expect(sheet).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.getByRole("dialog", { name: "Aktifkan notifikasi" })).toHaveCount(0);
  await context.close();
});

test("desktop: tanpa lembar ajakan otomatis", async ({ page }) => {
  await signedIn(page);
  await page.goto("/hub");
  await page.waitForTimeout(2500);
  await expect(page.getByRole("dialog", { name: "Aktifkan notifikasi" })).toHaveCount(0);
});

test("klik notifikasi (?notif=): ditandai dibaca, parameter notif dibuang, parameter lain tetap", async ({ page }) => {
  const calls = await signedIn(page);
  await page.goto("/hub/billing?notif=n123&tab=x");
  await expect.poll(() => calls.includes("POST /notifications/n123/read")).toBe(true);
  await expect(page).toHaveURL(/\/hub\/billing\?tab=x$/);
});
