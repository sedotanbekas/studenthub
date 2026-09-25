import { expect, type Page } from "@playwright/test";

/**
 * Skenario transisi geser halaman HP (dipakai uji Chromium & WebKit/Safari): tab bottom nav bergeser
 * bersebelahan searah posisi tab, halaman di dalamnya ala iOS; urutan lapisan, arah,
 * halaman yang bergeser selalu pekat, dan dialog absen baru terbuka setelah geser selesai.
 */
interface SlideSample {
  mode: string | null; ghostZ: string | null; pageZ: string | null; ghostX: number | null; pageX: number | null; pageBg: string; dialog: boolean;
  /** Tepi kiri banner demo yang hidup (ikut bergeser bersama halaman, bukan diam di atas). */
  bannerLeft: number | null; ghostHasBanner: boolean; overflowX: boolean; titleAnimation: string;
}

function sample(page: Page): Promise<SlideSample> {
  return page.evaluate(() => {
    const ghost = document.querySelector<HTMLElement>(".page-ghost");
    const live = document.querySelector<HTMLElement>(".hub-view");
    const banner = live?.querySelector<HTMLElement>(".demo-banner");
    const title = document.querySelector<HTMLElement>(".topbar-title");
    const x = (el: HTMLElement | null) => el ? new DOMMatrixReadOnly(getComputedStyle(el).transform === "none" ? undefined : getComputedStyle(el).transform).m41 : null;
    return {
      mode: document.documentElement.dataset.pageSlide ?? null, ghostZ: ghost ? getComputedStyle(ghost).zIndex : null, pageZ: live ? getComputedStyle(live).zIndex : null, ghostX: x(ghost), pageX: x(live), pageBg: live ? getComputedStyle(live).backgroundImage : "", dialog: Boolean(document.querySelector("dialog[open]")),
      bannerLeft: banner ? banner.getBoundingClientRect().left : null, ghostHasBanner: Boolean(ghost?.querySelector(".demo-banner")), overflowX: document.documentElement.scrollWidth > innerWidth, titleAnimation: title ? getComputedStyle(title).animationName : "",
    };
  });
}

const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Navigasi cepat" }).getByRole("link", { name });
const waitMode = (page: Page, mode: string) => page.waitForFunction(m => document.documentElement.dataset.pageSlide === m, mode);
const waitIdle = (page: Page) => page.waitForFunction(() => !document.documentElement.dataset.pageSlide && !document.querySelector(".page-ghost"));

export async function verifyPageSlides(page: Page): Promise<void> {
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Alya" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty("--page-duration", "1200ms"));

  // Bottom nav, tab tujuan di kanan (Beranda -> Rapor): isi lama & baru bergeser bersebelahan ke kiri.
  await tab(page, "Rapor").click();
  await waitMode(page, "tab-forward");
  const right = await sample(page);
  expect([right.ghostZ, right.pageZ]).toEqual(["15", "16"]);
  expect(right.pageX).toBeGreaterThan(0);
  expect(right.ghostX).toBeLessThanOrEqual(0);
  expect(right.pageBg).not.toBe("none");
  // Bagian atas (banner demo, judul topbar) tidak muncul seketika: banner ikut bergeser, banner lama
  // ada di hantu, judul masuk beranimasi; isi di luar layar tidak melebarkan dokumen.
  expect(right.bannerLeft).toBeGreaterThan(40);
  expect(right.ghostHasBanner).toBe(true);
  expect(right.titleAnimation).toBe("title-in-from-right");
  expect(right.overflowX).toBe(false);
  await waitIdle(page);
  await expect(page).toHaveURL(/\/hub\/my-reports$/);

  // Tab tujuan di kiri (Rapor -> Absensi): isi baru masuk dari kiri, isi lama keluar ke kanan.
  await tab(page, "Absensi").click();
  await waitMode(page, "tab-back");
  const left = await sample(page);
  expect(left.pageX).toBeLessThan(0);
  expect(left.ghostX).toBeGreaterThanOrEqual(0);
  expect(left.titleAnimation).toBe("title-in-from-left");
  expect(left.overflowX).toBe(false);
  await waitIdle(page);

  // Tombol kembali membalik langkah tab sebagai tab (Absensi -> Rapor: Rapor di kanan).
  await page.goBack();
  await waitMode(page, "tab-forward");
  await waitIdle(page);
  await expect(page).toHaveURL(/\/hub\/my-reports$/);

  // Halaman di dalam halaman utama (lonceng notifikasi): ala iOS, menutupi dari kanan.
  await page.locator(".topbar .notification-button").click();
  await waitMode(page, "forward");
  const push = await sample(page);
  expect([push.ghostZ, push.pageZ]).toEqual(["15", "16"]);
  expect(push.pageX).toBeGreaterThan(0);
  expect(push.ghostX).toBeLessThanOrEqual(0);
  expect(push.titleAnimation).toBe("title-in-from-right");
  await waitIdle(page);

  // Kembali dari halaman dalam: isi lama (lapisan atas) ke kanan, membuka halaman sebelumnya dari kiri.
  await page.getByRole("button", { name: "Kembali" }).click();
  await waitMode(page, "back");
  const back = await sample(page);
  expect([back.ghostZ, back.pageZ]).toEqual(["17", "16"]);
  expect(back.ghostX).toBeGreaterThanOrEqual(0);
  expect(back.pageX).toBeLessThanOrEqual(0);
  expect(back.ghostHasBanner).toBe(true);
  expect(back.titleAnimation).toBe("title-in-from-left");
  expect(back.overflowX).toBe(false);
  await waitIdle(page);
  await expect(page).toHaveURL(/\/hub\/my-reports$/);

  // Ke Beranda lewat tab (di kiri), lalu ubin Absen = halaman di dalam beranda (ala iOS); alur absen
  // (dialog) baru terbuka setelah halaman selesai bergeser.
  await tab(page, "Beranda").click();
  await waitMode(page, "tab-back");
  await waitIdle(page);
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  await page.locator(".tile", { hasText: "Absen" }).click();
  await waitMode(page, "forward");
  expect((await sample(page)).dialog).toBe(false);
  await expect(page.getByRole("dialog", { name: "Izinkan perangkat" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.pageSlide ?? null)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
