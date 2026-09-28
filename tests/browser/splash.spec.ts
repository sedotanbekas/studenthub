import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoStudents, demoSummary } from "../../src/lib/frontend/demo";

/**
 * Splash screen: tampil saat situs dibuka (belum login / terakhir dipakai > 5 menit lalu) dan saat kembali
 * ke tab setelah > 5 menit; masker logo menyingkap halaman TERAKHIR yang dilihat; transisi login. Setiap
 * perubahan <html data-splash> dicatat (dengan path & waktu) oleh skrip awal sebelum skrip boot berjalan.
 */
const identity = { user: { id: "user1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))] };
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });
const MIN = 60_000;
interface SplashEntry { phase: string | null; path: string; t: number }

async function mockSession(page: Page) {
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    const data = path === "/auth/me" ? identity : path === "/school/dashboard/summary" ? demoSummary : path === "/notifications/unread-count" ? { total: 0 } : path === "/school/students" ? demoStudents : [];
    return route.fulfill({ json: envelope(data, { page: 1, total: Array.isArray(data) ? data.length : 0, totalPages: 1 }) });
  });
}

/** Catatan kunjungan sebelumnya (sekali, sebelum halaman pertama) + perekam fase splash. */
async function prepare(page: Page, stored: { presenceAgoMs?: number; signedIn?: boolean; resume?: { path: string; y: number } } = {}) {
  await page.addInitScript(({ stored, now }) => {
    if (stored.presenceAgoMs !== undefined && !sessionStorage.getItem("__seeded")) {
      sessionStorage.setItem("__seeded", "1");
      localStorage.setItem("studenthub_presence", JSON.stringify({ seenAt: now - stored.presenceAgoMs, signedIn: stored.signedIn ?? true }));
      if (stored.resume) localStorage.setItem("studenthub_resume", JSON.stringify({ userId: "user1", ...stored.resume, at: now - stored.presenceAgoMs }));
    }
    const log: SplashEntry[] = [];
    (window as unknown as { __splash: SplashEntry[] }).__splash = log;
    new MutationObserver(() => {
      const phase = document.documentElement.dataset.splash ?? null;
      if (log.at(-1)?.phase !== phase) log.push({ phase, path: location.pathname, t: performance.now() });
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-splash"] }); // <html> belum ada saat skrip awal
  }, { stored, now: Date.now() });
}

const splashLog = (page: Page) => page.evaluate(() => (window as unknown as { __splash: SplashEntry[] }).__splash);
const splashDone = (page: Page) => page.waitForFunction(() => !document.documentElement.dataset.splash, null, { timeout: 10_000 });
const phases = (log: SplashEntry[]) => log.map(e => e.phase);
/** Lama splash: dari fase pertama sampai atribut dilepas. */
const duration = (log: SplashEntry[]) => log.at(-1)!.t - log[0]!.t;

/** Simulasi pindah aplikasi: tab tersembunyi, waktu berjalan `awayMs`, lalu tab terlihat lagi. */
async function leaveAndReturn(page: Page, awayMs: number) {
  const setVisibility = (state: string) => page.evaluate(state => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
  await setVisibility("hidden");
  await page.clock.fastForward(awayMs);
  await setVisibility("visible");
}

test("kunjungan pertama (belum login): splash lalu masker logo menyingkap halaman login, maksimal ±1 detik", async ({ page }) => {
  await prepare(page);
  await page.goto("/");
  await splashDone(page);
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  const log = await splashLog(page);
  expect(phases(log)).toEqual(["intro", "reveal", null]);
  expect(duration(log)).toBeLessThanOrEqual(1150);
});

test("sudah login & baru pergi <= 5 menit: tanpa splash, langsung ke halaman terakhir", async ({ page }) => {
  await mockSession(page);
  await prepare(page, { presenceAgoMs: 2 * MIN, resume: { path: "/hub/students", y: 0 } });
  await page.goto("/");
  await expect(page).toHaveURL(/\/hub\/students$/);
  await expect(page.getByText("Alya Putri Ramadhani", { exact: true })).toBeVisible();
  expect(phases(await splashLog(page))).toEqual([]);
});

test("sudah login & pergi > 5 menit: splash menyingkap halaman terakhir beserta posisi gulirnya", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await mockSession(page);
  await prepare(page, { presenceAgoMs: 5 * MIN + 1000, resume: { path: "/hub/students", y: 400 } });
  await page.goto("/");
  await splashDone(page);
  const log = await splashLog(page);
  expect(phases(log)).toEqual(["intro", "reveal", null]);
  expect(log.find(e => e.phase === "reveal")?.path, "yang disingkap = halaman terakhir").toBe("/hub/students");
  await expect(page.getByText("Alya Putri Ramadhani", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight), "halaman cukup panjang").toBeGreaterThan(400);
  await expect.poll(() => page.evaluate(() => Math.round(scrollY))).toBe(400);
});

test("kembali ke tab: > 5 menit (walau lebih 1 detik) -> splash, <= 5 menit -> tidak; halaman tetap", async ({ page }) => {
  await page.clock.install();
  await mockSession(page);
  await prepare(page, { presenceAgoMs: MIN, resume: { path: "/hub/students", y: 0 } });
  await page.goto("/hub/students");
  await expect(page.getByText("Alya Putri Ramadhani", { exact: true })).toBeVisible();
  expect(phases(await splashLog(page))).toEqual([]);

  await leaveAndReturn(page, 4 * MIN);
  await page.clock.runFor(1500);
  expect(phases(await splashLog(page)), "4 menit: tanpa splash").toEqual([]);

  await leaveAndReturn(page, 5 * MIN + 1000);
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.splash)).toBe("intro");
  await page.clock.runFor(1200);
  await splashDone(page);
  expect(phases(await splashLog(page))).toEqual(["intro", "reveal", null]);
  await expect(page).toHaveURL(/\/hub\/students$/);
});

test("login (demo): tirai dari tombol lalu masker menyingkap beranda, maksimal ±1 detik", async ({ page }) => {
  await prepare(page, { presenceAgoMs: 0, signedIn: false });
  await page.goto("/hub");
  await splashDone(page);
  await page.evaluate(() => { (window as unknown as { __splash: unknown[] }).__splash.length = 0; });
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await expect(page.getByRole("heading", { name: /Selamat datang/ })).toBeVisible();
  await splashDone(page);
  const log = await splashLog(page);
  expect(phases(log)).toEqual(["wipe", "reveal", null]);
  expect(duration(log)).toBeLessThanOrEqual(1150);
});

test("keluar: halaman terakhir dilupakan (tidak dilanjutkan saat masuk lagi)", async ({ page }) => {
  await mockSession(page);
  await prepare(page, { presenceAgoMs: MIN, resume: { path: "/hub/students", y: 0 } });
  await page.goto("/hub/students");
  await expect(page.getByText("Alya Putri Ramadhani", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("studenthub_resume") ?? "null")?.path)).toBe("/hub/students");
  await page.getByRole("button", { name: /Keluar dari akun/ }).click();
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("studenthub_resume"))).toBeNull();
});
