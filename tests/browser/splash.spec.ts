import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoStudents, demoSummary } from "../../src/lib/frontend/demo";
import { markSignedIn } from "./session-cookie";

/**
 * Splash screen: HANYA untuk yang sudah masuk — saat situs dibuka / kembali ke tab setelah > 5 menit, masker
 * logo menyingkap halaman TERAKHIR yang dilihat; transisi masuk (1-2-3) dan keluar (3-2-1). Tamu langsung
 * melihat halaman masuk (dirender server, tanpa splash). Setiap perubahan <html data-splash> dicatat (dengan
 * path & waktu) oleh skrip awal sebelum skrip boot berjalan.
 */
const identity = { user: { id: "user1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))] };
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });
const MIN = 60_000;
interface SplashEntry { phase: string | null; path: string; t: number }

async function mockSession(page: Page) {
  await markSignedIn(page);
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

test("tamu (kunjungan pertama): tanpa splash, halaman masuk sudah ada di HTML server, tanpa permintaan sesi yang gagal", async ({ page }) => {
  const html = await (await page.request.get("/hub")).text();
  expect(html, "halaman masuk dirender server").toContain("Senang bertemu lagi.");
  expect(html).not.toContain("Memuat…");
  const auth: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/web/auth/")) auth.push(request.url()); });
  const errors: string[] = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await prepare(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Masuk", exact: true })).toHaveAttribute("type", "submit");
  await page.waitForLoadState("networkidle");
  expect(phases(await splashLog(page))).toEqual([]);
  expect(auth, "tanpa GET /auth/me & /auth/refresh untuk tamu").toEqual([]);
  expect(errors).toEqual([]);
});

test("penanda demo basi (sesi demo milik tab lain) dihapus: muat berikutnya langsung halaman masuk dari server", async ({ page }) => {
  await page.context().addCookies([{ name: "studenthub_demo", value: "1", url: "http://localhost:3030" }]);
  await page.goto("/hub");
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  await expect.poll(async () => (await page.context().cookies()).some(c => c.name === "studenthub_demo" && c.value === "1")).toBe(false);
  expect(await (await page.request.get("/hub")).text()).toContain("Senang bertemu lagi.");
});

test("tamu kembali ke tab setelah > 5 menit: tetap tanpa splash", async ({ page }) => {
  await page.clock.install();
  await prepare(page, { presenceAgoMs: 10 * MIN, signedIn: false });
  await page.goto("/hub");
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  await leaveAndReturn(page, 6 * MIN);
  await page.clock.runFor(1500);
  expect(phases(await splashLog(page))).toEqual([]);
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
  // Seperti pengguna sungguhan: kursor mendekati tombol demo lebih dulu (memanaskan modul isi hub).
  // Mode dev mengompilasi modul itu saat diminta pertama kali; yang diukur di sini koreografi animasinya.
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).hover();
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => { (window as unknown as { __splash: unknown[] }).__splash.length = 0; });
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await expect(page.getByRole("heading", { name: /Selamat datang/ })).toBeVisible();
  await splashDone(page);
  const log = await splashLog(page);
  expect(phases(log)).toEqual(["wipe", "reveal", null]);
  expect(duration(log)).toBeLessThanOrEqual(1150);
});

test("keluar: kebalikan masuk (masker menutup -> logo -> tirai ke tombol Masuk), halaman terakhir dilupakan", async ({ page }) => {
  await mockSession(page);
  await prepare(page, { presenceAgoMs: MIN, resume: { path: "/hub/students", y: 0 } });
  await page.goto("/hub/students");
  await expect(page.getByText("Alya Putri Ramadhani", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("studenthub_resume") ?? "null")?.path)).toBe("/hub/students");
  await page.evaluate(() => { (window as unknown as { __splash: unknown[] }).__splash.length = 0; });
  await page.getByRole("button", { name: /Keluar dari akun/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.splash)).toBe("close");
  expect(await page.evaluate(() => document.documentElement.dataset.splashKind)).toBe("logout");
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  await splashDone(page);
  const log = await splashLog(page);
  expect(phases(log)).toEqual(["close", "hold", "unwipe", null]);
  expect(log.find(e => e.phase === "unwipe")?.path, "yang disingkap = halaman masuk").toBe("/hub");
  // Koreografi (masker menutup ±460 ms, tirai ±420 ms); jeda logo di antaranya ikut menunggu navigasi ke /hub.
  const at = (phase: string | null) => log.find(e => e.phase === phase)!.t;
  expect(at("hold") - at("close")).toBeLessThanOrEqual(560);
  expect(at(null) - at("unwipe")).toBeLessThanOrEqual(520);
  expect(duration(log)).toBeLessThanOrEqual(1600);
  expect(await page.evaluate(() => localStorage.getItem("studenthub_resume"))).toBeNull();
});
