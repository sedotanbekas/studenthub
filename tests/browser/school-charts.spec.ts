import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { dayLabel } from "../../src/lib/frontend/chart-rules";
import { demoSummary } from "../../src/lib/frontend/demo";
import { demoAnalyticsRows, demoSchoolTrend } from "../../src/lib/frontend/demo-analytics";
import { trendRange } from "../../src/lib/frontend/school-chart-rules";

/** Grafik interaktif beranda admin sekolah (mode demo). Waktu dipatok agar data contoh deterministik. */
const NOW = new Date("2026-09-26T03:00:00Z"); // Sabtu 10.00 WIB
const TODAY = "2026-09-26";
const number = (n: number) => new Intl.NumberFormat("id-ID").format(n);

async function openDashboard(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await expect(page.getByRole("heading", { name: /Selamat datang/ })).toBeVisible();
  await expect(page.locator(".sc-trend .chart-canvas svg")).toBeVisible();
}

test("donat hari ini: legenda lengkap, sorot segmen, tautan ke peta kehadiran", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await openDashboard(page);
  const panel = page.locator(".sc-today");
  await expect(panel.getByRole("heading", { name: "Kehadiran hari ini" })).toBeVisible();
  await expect(panel.locator(".donut-center strong")).toHaveText("95,2%");
  await expect(panel.locator(".donut-center span")).toHaveText("hadir + terlambat");
  const legend = panel.locator(".donut-legend button");
  await expect(legend).toHaveCount(6);
  for (const [i, label] of ["Hadir", "Terlambat", "Izin", "Sakit", "Alpa", "Belum absen"].entries()) await expect(legend.nth(i)).toContainText(label);
  await legend.nth(2).hover();
  await expect(panel.locator(".donut-center span")).toHaveText("Izin");
  await expect(panel.locator(".donut-figure path.dim")).toHaveCount(5);
  await expect(panel.getByRole("link", { name: /Lihat peta kehadiran/ })).toHaveAttribute("href", "/hub/attendance");
  const month = page.locator(".sc-month");
  await expect(month).toContainText("Kehadiran bulan ini");
  await expect(month).toContainText(/\+\d+,\d poin/);
  expect(errors).toEqual([]);
});

test("tren: hover kolom menampilkan tanggal & angka, fokus selain hadir, ganti ke 14 hari", async ({ page }) => {
  await openDashboard(page);
  const panel = page.locator(".sc-trend");
  await expect(panel.getByRole("radio", { name: "30 hari" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.locator(".chart-columns > g")).toHaveCount(30);
  const range = trendRange(30, TODAY);
  const days = demoSchoolTrend(range.from, range.to, TODAY).days;
  const index = days.findLastIndex(d => d.isSchoolDay);
  const day = days[index]!;
  await panel.locator(".chart-pointer").scrollIntoViewIfNeeded();
  const box = (await panel.locator(".chart-pointer").boundingBox())!;
  await page.mouse.move(box.x + (box.width * (index + 0.5)) / days.length, box.y + box.height / 2);
  const tooltip = panel.locator(".chart-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(dayLabel(day.date));
  await expect(tooltip).toContainText(number(day.counts.hadir));
  await expect(tooltip).toContainText(`Hadir tepat waktu + terlambat: ${new Intl.NumberFormat("id-ID", { minimumFractionDigits: 1 }).format(day.presentPct!)}%`);
  const weekend = days.findIndex(d => !d.isSchoolDay);
  await page.mouse.move(box.x + (box.width * (weekend + 0.5)) / days.length, box.y + box.height / 2);
  await expect(tooltip).toContainText("Bukan hari sekolah");

  await panel.getByRole("radio", { name: "Selain hadir" }).click();
  await expect(panel.locator(".chart-legend-row button")).toHaveCount(4);
  await expect(panel.locator(".chart-legend-row")).not.toContainText(/^Hadir/);
  await panel.getByRole("radio", { name: "14 hari" }).click();
  await expect(panel.getByRole("radio", { name: "14 hari" })).toHaveAttribute("aria-checked", "true");
  await expect(panel.locator(".chart-columns > g")).toHaveCount(14);
  await expect(panel.locator(".sc-highlights")).toContainText("Rata-rata hadir");
});

test("per kelas: terendah di atas, kelas < 90% dikelompokkan 'perlu perhatian', daftar bisa dibuka", async ({ page }) => {
  await openDashboard(page);
  const panel = page.locator(".sc-classes");
  const attention = panel.locator(".sc-group-attention");
  await expect(attention).toContainText("Perlu perhatian · di bawah 90%");
  await expect(attention.locator(".bar-row")).toHaveCount(1);
  await expect(attention.locator(".bar-row")).toHaveAttribute("aria-label", /^XI IPS 2: \d+,\d%\. Terlambat \d+,\d% · Alpa \d+,\d% · \d+ catatan$/);
  const rows = panel.locator(".bar-row");
  await expect(rows).toHaveCount(6);
  const values = await rows.evaluateAll(els => els.map(el => Number((el.querySelector(".bar-value")?.textContent ?? "").replace("%", "").replace(",", "."))));
  expect(values).toEqual([...values].sort((a, b) => a - b));
  await panel.getByRole("button", { name: "Tampilkan 2 kelas lainnya" }).click();
  await expect(rows).toHaveCount(8);
  await expect(panel.getByRole("button", { name: "Tampilkan lebih sedikit" })).toHaveAttribute("aria-expanded", "true");
});

test("API asli: panel tren yang gagal tidak menyembunyikan panel lain; 'Coba lagi' memuat ulang dengan rentang benar", async ({ page }) => {
  const identity = { user: { id: "u1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))] };
  const envelope = (data: unknown) => ({ success: true, data, error: null, meta: null });
  let failTrend = true;
  const trendQueries: string[] = [];
  await page.clock.setFixedTime(NOW);
  await page.route("**/api/web/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/web", "");
    if (path === "/school/attendance/analytics/trend") {
      trendQueries.push(url.search);
      if (failTrend) return route.fulfill({ status: 503, json: { success: false, error: { code: "UNAVAILABLE", message: "Tren sedang tidak tersedia." } } });
    }
    const data = path === "/auth/me" ? identity : path === "/school/dashboard/summary" ? demoSummary : demoAnalyticsRows(`${path}${url.search}`, TODAY) ?? [];
    return route.fulfill({ json: envelope(data) });
  });
  await page.goto("/hub");
  const trend = page.locator(".sc-trend");
  await expect(trend.getByRole("alert")).toContainText("Tren sedang tidak tersedia.");
  await expect(page.locator(".sc-today .donut-center strong")).toHaveText("95,2%");
  await expect(page.locator(".sc-classes .bar-row")).toHaveCount(6);
  await expect(page.locator(".sc-month")).toContainText("Kehadiran bulan ini");
  failTrend = false;
  await trend.getByRole("button", { name: "Coba lagi" }).click();
  await expect(trend.locator(".chart-columns > g")).toHaveCount(30);
  const range = trendRange(30, TODAY);
  expect(trendQueries.at(-1)).toBe(`?from=${range.from}&to=${range.to}`);
});

test("HP 390px: semua panel tampil tanpa luapan horizontal, tap tren memunculkan tooltip di dalam layar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page);
  for (const selector of [".sc-today", ".sc-month", ".sc-trend", ".sc-classes"]) await expect(page.locator(selector)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".school-charts").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  const panel = page.locator(".sc-trend");
  await panel.locator(".chart-pointer").scrollIntoViewIfNeeded();
  const box = (await panel.locator(".chart-pointer").boundingBox())!;
  await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
  const tip = (await panel.locator(".chart-tooltip").boundingBox())!;
  expect(tip.x).toBeGreaterThanOrEqual(0);
  expect(tip.x + tip.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("donat: klik legenda menyorot tetap (klik lagi melepas); fokus keyboard menyorot tanpa mengubah pilihan", async ({ page }) => {
  await openDashboard(page);
  const panel = page.locator(".sc-today");
  const legend = panel.locator(".donut-legend button");
  const center = panel.locator(".donut-center span");
  await legend.nth(3).click();
  await page.mouse.move(0, 0);
  await expect(legend.nth(3)).toHaveAttribute("aria-pressed", "true");
  await expect(center).toHaveText("Sakit");
  await expect(panel.locator(".donut-figure path.dim")).toHaveCount(5);
  await legend.nth(3).click();
  await page.mouse.move(0, 0);
  await expect(legend.nth(3)).toHaveAttribute("aria-pressed", "false");
  await expect(center).toHaveText("hadir + terlambat");

  await legend.nth(1).focus();
  await page.keyboard.press("Tab");
  await expect(legend.nth(2)).toBeFocused();
  await expect(center).toHaveText("Izin");
  await page.keyboard.press("Enter");
  await expect(legend.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(center).toHaveText("Izin");
});

test("tren: kontrol segmen — panah/Home/End memindah pilihan DAN fokus", async ({ page }) => {
  await openDashboard(page);
  const period = page.locator(".sc-trend").getByRole("radiogroup", { name: "Periode tren kehadiran" });
  const r14 = period.getByRole("radio", { name: "14 hari" });
  const r30 = period.getByRole("radio", { name: "30 hari" });
  await r30.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(r14).toHaveAttribute("aria-checked", "true");
  await expect(r14).toBeFocused();
  await page.keyboard.press("End");
  await expect(r30).toHaveAttribute("aria-checked", "true");
  await expect(r30).toBeFocused();
  await page.keyboard.press("Home");
  await expect(r14).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(r30).toBeFocused();
  await expect(page.locator(".sc-trend .chart-columns > g")).toHaveCount(30);
});

test("tren: wilayah live permanen mengumumkan nilai pertama lewat keyboard", async ({ page }) => {
  await openDashboard(page);
  const panel = page.locator(".sc-trend");
  const live = panel.locator(".chart > [aria-live='polite']");
  await expect(live).toHaveCount(1);
  await expect(live).toHaveText("");
  await panel.locator(".chart-pointer").focus();
  await page.keyboard.press("ArrowRight");
  const range = trendRange(30, TODAY);
  await expect(live).toContainText(dayLabel(range.from));
  await expect(live).toContainText("Hadir");
  await expect(panel.locator(".chart-tooltip [aria-live]")).toHaveCount(0);
});

test.describe("layar sentuh", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });
  test("donat: tap segmen menyorot dan tetap tersorot; tap lagi melepas", async ({ page }) => {
    await openDashboard(page);
    const panel = page.locator(".sc-today");
    const izin = panel.locator(".donut-figure path").nth(2);
    await izin.scrollIntoViewIfNeeded();
    await izin.tap();
    await expect(panel.locator(".donut-center span")).toHaveText("Izin");
    await expect(panel.locator(".donut-figure path.dim")).toHaveCount(5);
    await expect(panel.locator(".donut-legend button").nth(2)).toHaveAttribute("aria-pressed", "true");
    await izin.tap();
    await expect(panel.locator(".donut-center span")).toHaveText("hadir + terlambat");
  });
});
