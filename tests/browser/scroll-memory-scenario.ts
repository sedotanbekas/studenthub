import { expect, type Page } from "@playwright/test";

/**
 * Skenario ingatan posisi gulir (dipakai uji Chromium & WebKit/Safari HP): pindah tab lalu kembali
 * mendarat di posisi gulir terakhir halaman itu, halaman yang belum pernah dibuka mulai dari atas, tombol
 * kembali memulihkan posisi, dan menekan tab yang sedang aktif menggulir ke atas.
 */
const tab = (page: Page, name: string) => page.getByRole("navigation", { name: "Navigasi cepat" }).getByRole("link", { name });
const scrollY = (page: Page) => page.evaluate(() => Math.round(window.scrollY));
const waitIdle = (page: Page) => page.waitForFunction(() => !document.documentElement.dataset.pageSlide && !document.querySelector(".page-ghost"));
const expectAt = (page: Page, y: number) => expect.poll(async () => Math.abs(await scrollY(page) - y), { timeout: 5000 }).toBeLessThanOrEqual(2);

/** Gulir ke `y` (dibatasi tinggi halaman) lalu tunggu event scroll tercatat; hasilnya posisi sebenarnya. */
function scrollTo(page: Page, y: number): Promise<number> {
  return page.evaluate(async target => {
    window.scrollTo(0, Math.min(target, document.documentElement.scrollHeight - innerHeight));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return Math.round(window.scrollY);
  }, y);
}

async function goTab(page: Page, name: string, heading: string): Promise<void> {
  await tab(page, name).click();
  await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  await waitIdle(page);
}

export async function verifyScrollMemory(page: Page): Promise<void> {
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Alya" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();

  // Kunjungan pertama selalu dari atas; gulir Absensi ke bawah.
  await goTab(page, "Absensi", "Absensi");
  await expect(page.getByRole("heading", { name: /^Riwayat / })).toBeVisible();
  await expectAt(page, 0);
  const attendanceY = await scrollTo(page, 520);
  expect(attendanceY).toBeGreaterThan(100);

  // Rapor belum pernah dibuka: mulai dari atas walau Absensi tadi tergulir; gulir Rapor ke paling bawah.
  await goTab(page, "Rapor", "Rapor saya");
  await expect(page.getByRole("cell", { name: /Semester/ }).first()).toBeVisible();
  await expectAt(page, 0);
  const reportY = await scrollTo(page, 10_000);
  expect(reportY).toBeGreaterThan(0);

  // Kembali ke tab masing-masing: posisi terakhirnya dipulihkan (keluhan utama).
  await goTab(page, "Absensi", "Absensi");
  await expectAt(page, attendanceY);
  await goTab(page, "Rapor", "Rapor saya");
  await expectAt(page, reportY);

  // Tombol kembali browser juga memulihkan posisi halaman sebelumnya.
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Absensi" })).toBeVisible();
  await waitIdle(page);
  await expectAt(page, attendanceY);

  // Tab aktif ditekan lagi: gulir ke atas (ala iOS) tanpa pindah halaman; posisi baru ikut diingat.
  await tab(page, "Absensi").click();
  await expectAt(page, 0);
  await expect(page).toHaveURL(/\/hub\/my-attendance$/);
  await goTab(page, "Rapor", "Rapor saya");
  await expectAt(page, reportY);
  await goTab(page, "Absensi", "Absensi");
  await expectAt(page, 0);

  // Ganti persona demo di halaman yang sama: isinya kini milik akun lain, dimulai dari atas.
  expect(await scrollTo(page, 520)).toBeGreaterThan(100);
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption({ label: "Siswa · Bima" });
  await expectAt(page, 0);
}
