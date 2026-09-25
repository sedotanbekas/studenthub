import { expect, type Page } from "@playwright/test";

/**
 * Skenario transisi geser halaman HP (dipakai uji Chromium & WebKit/Safari): urutan lapisan, arah,
 * halaman yang bergeser selalu pekat, dan dialog absen baru terbuka setelah geser selesai.
 */
interface SlideSample { mode: string | null; ghostZ: string | null; pageZ: string | null; ghostX: number | null; pageX: number | null; pageBg: string; dialog: boolean }

function sample(page: Page): Promise<SlideSample> {
  return page.evaluate(() => {
    const ghost = document.querySelector<HTMLElement>(".page-ghost");
    const live = document.querySelector<HTMLElement>(".hub-page");
    const x = (el: HTMLElement | null) => el ? new DOMMatrixReadOnly(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform).m41 : null;
    return { mode: document.documentElement.dataset.pageSlide ?? null, ghostZ: ghost ? getComputedStyle(ghost).zIndex : null, pageZ: live ? getComputedStyle(live).zIndex : null, ghostX: x(ghost), pageX: x(live), pageBg: live ? getComputedStyle(live).backgroundImage : "", dialog: Boolean(document.querySelector("dialog[open]")) };
  });
}

const waitMode = (page: Page, mode: string) => page.waitForFunction(m => document.documentElement.dataset.pageSlide === m, mode);
const waitIdle = (page: Page) => page.waitForFunction(() => !document.documentElement.dataset.pageSlide && !document.querySelector(".page-ghost"));

export async function verifyPageSlides(page: Page): Promise<void> {
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Alya" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty("--page-duration", "1200ms"));

  // Masuk halaman: halaman baru (lapisan atas, pekat) dari kanan menutupi halaman lama yang ke kiri.
  await page.getByRole("navigation", { name: "Navigasi cepat" }).getByRole("link", { name: "Rapor" }).click();
  await waitMode(page, "forward");
  const forward = await sample(page);
  expect([forward.ghostZ, forward.pageZ]).toEqual(["15", "16"]);
  expect(forward.pageX).toBeGreaterThan(0);
  expect(forward.ghostX).toBeLessThanOrEqual(0);
  expect(forward.pageBg).not.toBe("none");
  await waitIdle(page);
  await expect(page).toHaveURL(/\/hub\/my-reports$/);

  // Kembali: halaman lama (lapisan atas) ke kanan, membuka halaman sebelumnya dari kiri.
  await page.goBack();
  await waitMode(page, "back");
  const back = await sample(page);
  expect([back.ghostZ, back.pageZ]).toEqual(["17", "16"]);
  expect(back.ghostX).toBeGreaterThanOrEqual(0);
  expect(back.pageX).toBeLessThanOrEqual(0);
  await waitIdle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();

  // Tile Absen: alur absen (dialog) baru terbuka setelah halaman selesai bergeser.
  await page.locator(".tile", { hasText: "Absen" }).click();
  await waitMode(page, "forward");
  expect((await sample(page)).dialog).toBe(false);
  await expect(page.getByRole("dialog", { name: "Izinkan perangkat" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.pageSlide ?? null)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
