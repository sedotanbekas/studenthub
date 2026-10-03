import { expect, test, type Page } from "@playwright/test";

/**
 * Notifikasi absensi (N4, mode demo): kartu Alpa milik Alya membawa tombol "Ajukan izin/sakit" yang membuka formulir
 * dengan tanggal terisi; rekap harian admin membawa "Buka kehadiran" yang membuka peta pada tanggal itu.
 */

async function openDemo(page: Page, role: string, path: string) {
  await page.addInitScript(value => {
    sessionStorage.setItem("studenthub_demo", "true");
    sessionStorage.setItem("studenthub_demo_role", value);
  }, role);
  await page.goto(path);
}

/** Tanggal (YYYY-MM-DD) dari href tombol tindakan kartu. */
async function ctaDate(page: Page, name: string): Promise<string> {
  const href = await page.getByRole("link", { name }).getAttribute("href");
  const date = /=(\d{4}-\d{2}-\d{2})$/.exec(href ?? "")?.[1];
  if (!date) throw new Error(`href tanpa tanggal: ${href}`);
  return date;
}

test("siswa Alya: kabar terbaru memuat Alpa; Ajukan izin/sakit membuka formulir dengan tanggal terisi", async ({ page }) => {
  await openDemo(page, "STUDENT", "/hub");
  const news = page.locator("section", { has: page.getByRole("heading", { name: "Kabar terbaru" }) });
  await expect(news.getByText(/^Alpa pada /)).toBeVisible();

  await page.goto("/hub/notifications");
  const card = page.locator(".feed-card.has-cta");
  await expect(card).toHaveCount(1);
  await expect(card.getByRole("heading", { name: /^Alpa pada / })).toBeVisible();
  await expect(card).toContainText("Bila berhalangan, ajukan izin/sakit paling lambat");
  await expect(card).toContainText("Sudah mengajukan? Lihat di menu Izin & sakit.");
  const date = await ctaDate(page, "Ajukan izin/sakit");

  await card.getByRole("link", { name: "Ajukan izin/sakit" }).click();
  await expect(page).toHaveURL(/\/hub\/my-leave$/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const dates = dialog.locator('input[type="date"]');
  await expect(dates.nth(0)).toHaveValue(date);
  await expect(dates.nth(1)).toHaveValue(date);
});

test("admin sekolah: rekap harian -> Buka kehadiran membuka peta pada tanggal itu", async ({ page }) => {
  await openDemo(page, "SCHOOL_ADMIN", "/hub/notifications");
  const card = page.locator(".feed-card.has-cta");
  await expect(card.getByRole("heading", { name: /^Rekap kehadiran / })).toBeVisible();
  await expect(card).toContainText("Alpa 8 · Terlambat 24 · Izin 18 · Sakit 12. 3 perlu ditinjau.");
  const date = await ctaDate(page, "Buka kehadiran");

  await card.getByRole("link", { name: "Buka kehadiran" }).click();
  await expect(page).toHaveURL(/\/hub\/attendance$/);
  await expect(page.getByRole("heading", { level: 1, name: "Kehadiran" })).toBeVisible();
  await expect(page.locator('.monitor-page input[type="date"]').first()).toHaveValue(date);
});

test("persona tanpa notifikasi absensi (Bima) tidak melihat kartu bertindakan", async ({ page }) => {
  await openDemo(page, "STUDENT_BIMA", "/hub/notifications");
  await expect(page.locator(".feed-card").first()).toBeVisible();
  await expect(page.locator(".feed-card.has-cta")).toHaveCount(0);
});
