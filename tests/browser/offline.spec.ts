import { expect, test } from "@playwright/test";

/**
 * Halaman offline dari service worker sungguhan (/sw.js, 2026-10-08): konfigurasi memblokir SW untuk spec lain (mock
 * page.route), di sini diizinkan. /pasang mendaftarkan SW tanpa login; navigasi saat offline -> halaman bawaan sw.js,
 * kembali online -> muat ulang otomatis ke halaman aslinya.
 */
test("aplikasi terpasang tanpa internet: halaman offline + Coba lagi; tersambung lagi -> halaman asli dimuat otomatis", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "allow", viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  await page.goto("/pasang");
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; return navigator.serviceWorker.controller !== null; }, undefined, { timeout: 20_000 });
  await context.setOffline(true);
  await page.goto("/hub");
  await expect(page.getByRole("heading", { name: "Kamu sedang offline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByRole("heading", { name: "Kamu sedang offline" })).toBeHidden({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/hub$/);
  await context.close();
});

test("navigasi lewat service worker: header keamanan respons asli (CSP) tetap berlaku — berkas sandbox tetap terkunci", async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: "allow" });
  const page = await context.newPage();
  await page.goto("/pasang");
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; return navigator.serviceWorker.controller !== null; }, undefined, { timeout: 20_000 });
  const injectInline = () => page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.__inlineRan = true";
    document.body.appendChild(script);
    return { controlled: navigator.serviceWorker.controller !== null, ran: (window as unknown as { __inlineRan?: boolean }).__inlineRan === true };
  });
  expect(await injectInline(), "pembanding: halaman tanpa CSP menjalankan skrip sebaris").toEqual({ controlled: true, ran: true });
  // /sw.js dikirim dengan CSP script-src 'self' (next.config.ts): skrip sebaris di dokumennya harus ditolak.
  await page.goto("/sw.js");
  expect(await injectInline()).toEqual({ controlled: true, ran: false });
  await context.close();
});
