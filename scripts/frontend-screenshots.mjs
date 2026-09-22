/** Jalankan sesudah pnpm dev; screenshot memakai data demo, tanpa kredensial atau mutasi API. */
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";

const output = "docs/frontend/screenshots";
const base = process.env.FRONTEND_BASE_URL ?? "http://localhost:3030";
await mkdir(output, { recursive: true });
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.locator(".skeleton").first().waitFor({ state: "hidden" });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true, animations: "disabled" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error(`Halaman ${name} meluap secara horizontal.`);
  console.log(`Screenshot: ${output}/${name}.png`);
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Senang bertemu lagi." }).waitFor();
  await capture("01-login-desktop");
  await page.getByRole("button", { name: "Jelajahi tampilan demo" }).click();
  await page.getByRole("heading", { name: /Selamat datang/ }).waitFor();
  await capture("02-dashboard-desktop");
  for (const [route, title, name] of [["students", "Data siswa", "03-siswa-desktop"], ["announcements", "Pengumuman", "05-pengumuman-desktop"], ["calendar", "Kalender sekolah", "06-kalender-desktop"]]) {
    await page.goto(`${base}/hub/${route}`);
    await page.getByRole("heading", { level: 1, name: new RegExp(title) }).waitFor();
    await page.locator(".data-panel .skeleton").first().waitFor({ state: "hidden" });
    await page.waitForTimeout(350);
    await capture(name);
    if (route === "students") {
      await page.getByRole("button", { name: "Tambah siswa" }).click();
      await page.getByRole("dialog").waitFor();
      await capture("04-formulir-siswa-desktop");
      await page.keyboard.press("Escape");
    }
  }
  await page.goto(`${base}/hub`);
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption("SPONSOR");
  await page.getByRole("navigation").getByRole("link", { name: "Kampanye saya", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: /Kampanye saya/ }).waitFor();
  await capture("07-sponsor-desktop");
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption("SCHOOL_ADMIN");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/hub`);
  await page.getByRole("heading", { name: /Selamat datang/ }).waitFor();
  await capture("08-dashboard-mobile");
  await page.goto(`${base}/hub/students`);
  await page.getByRole("button", { name: "Tambah siswa" }).click();
  await page.getByRole("dialog").waitFor();
  await capture("09-formulir-mobile");
  if (errors.length) throw new Error(errors.join("\n"));
} finally { await browser.close(); }
