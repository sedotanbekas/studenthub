import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoSummary } from "../../src/lib/frontend/demo";
import { markSignedIn } from "./session-cookie";

/**
 * Badge notifikasi N1: satu poller bersama memperbarui lonceng & sidebar selama halaman terlihat, berhenti saat
 * tersembunyi, langsung menyegarkan setelah "Tandai semua dibaca", tanpa jaringan di demo, dan berhenti saat keluar.
 * Jam dipalsukan (page.clock) dan /api/web di-mock.
 */

const identity = {
  user: { id: "user1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false },
  school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))],
};
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });

interface Mock { total: number; calls: number; loggedOut: boolean }

async function signedIn(page: Page, total: number): Promise<Mock> {
  const mock: Mock = { total, calls: 0, loggedOut: false };
  await page.clock.install();
  await markSignedIn(page);
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    if (path === "/notifications/unread-count") {
      mock.calls++;
      return route.fulfill({ json: envelope({ total: mock.total, announcements: 0, personal: mock.total, latestCreatedAt: null }) });
    }
    if (path === "/notifications/read-all") { mock.total = 0; return route.fulfill({ json: envelope({ updated: 3 }) }); }
    if (path === "/me/notification-preferences") return route.fulfill({ json: envelope({ mutedCategories: [], mutableCategories: ["FINANCE", "STUDENT_AFFAIRS", "ATTENDANCE"], updatedAt: null, updatedBy: null }) });
    if (path === "/auth/logout") { mock.loggedOut = true; return route.fulfill({ json: envelope({ ok: true }) }); }
    if (path === "/auth/me" && mock.loggedOut) return route.fulfill({ status: 401, json: { success: false, data: null, error: { code: "UNAUTHENTICATED", message: "Silakan login." }, meta: null } });
    const data = path === "/auth/me" ? identity : path === "/school/dashboard/summary" ? demoSummary : [];
    return route.fulfill({ json: envelope(data, { page: 1, total: 0, limit: 20, totalPages: 0 }) });
  });
  return mock;
}

const bell = (page: Page) => page.locator(".notification-button");
const setVisibility = (page: Page, state: "visible" | "hidden") => page.evaluate(value => {
  Object.defineProperty(document, "visibilityState", { value, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}, state);

test("badge diperbarui berkala selama terlihat; 99+ di atas 99", async ({ page }) => {
  const mock = await signedIn(page, 3);
  await page.goto("/hub");
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 3 belum dibaca");
  await expect(page.getByRole("navigation").getByRole("link", { name: /Notifikasi/ }).locator(".count-badge")).toHaveText("3");
  mock.total = 5;
  await page.clock.runFor(34_000);
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 5 belum dibaca");
  mock.total = 150;
  await page.clock.runFor(34_000);
  await expect(page.getByRole("navigation").getByRole("link", { name: /Notifikasi/ }).locator(".count-badge")).toHaveText("99+");
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 99+ belum dibaca");
});

test("tersembunyi = tanpa permintaan; terlihat lagi = satu permintaan segera", async ({ page }) => {
  const mock = await signedIn(page, 2);
  await page.goto("/hub");
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 2 belum dibaca");
  await page.clock.runFor(10_000);
  await setVisibility(page, "hidden");
  const before = mock.calls;
  await page.clock.runFor(300_000);
  expect(mock.calls).toBe(before);
  mock.total = 4;
  await setVisibility(page, "visible");
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 4 belum dibaca");
  expect(mock.calls).toBe(before + 1);
});

test("Tandai semua dibaca -> badge hilang tanpa menunggu 30 detik", async ({ page }) => {
  const mock = await signedIn(page, 3);
  await page.goto("/hub/notifications");
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 3 belum dibaca");
  const before = mock.calls;
  await page.getByRole("button", { name: "Tandai semua dibaca" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Simpan & lanjutkan" }).click();
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi");
  expect(mock.calls).toBe(before + 1);
});

test("keluar menghentikan polling", async ({ page }) => {
  const mock = await signedIn(page, 1);
  await page.goto("/hub");
  await expect(bell(page)).toHaveAttribute("aria-label", "Notifikasi, 1 belum dibaca");
  await page.getByRole("button", { name: /Keluar dari akun/ }).click();
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  const after = mock.calls;
  await page.clock.runFor(120_000);
  expect(mock.calls).toBe(after);
});

test("demo: angka contoh tanpa satu pun permintaan unread-count", async ({ page }) => {
  let calls = 0;
  await page.clock.install();
  await page.route("**/api/web/notifications/unread-count", route => { calls++; return route.abort(); });
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await expect(bell(page)).toHaveAttribute("aria-label", /Notifikasi, \d+ belum dibaca/);
  await page.clock.runFor(120_000);
  expect(calls).toBe(0);
});
