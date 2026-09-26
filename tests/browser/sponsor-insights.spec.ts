import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoAdPerformance, demoAnalyticsBreakdown, demoAnalyticsSeries, demoAnalyticsSummary, demoBalance, demoSponsorAds, demoSponsorProfile } from "../../src/lib/frontend/demo-ads";

/**
 * Beranda & analitik sponsor: mode demo (tanpa API) untuk isi, interaksi grafik, filter, dan tata letak
 * HP; mode API tiruan untuk akun yang masih ditinjau, saldo menipis, query periode, dan galat + coba lagi.
 */

async function demoSponsor(page: Page) {
  await page.addInitScript(() => { sessionStorage.setItem("studenthub_demo", "true"); sessionStorage.setItem("studenthub_demo_role", "SPONSOR"); });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const identity = { user: { id: "sp1", name: "Rizky Pratama", email: "rizky@example.test", role: "SPONSOR", mustChangePassword: false, totpEnrollmentRequired: false }, school: null, sponsor: { id: "demo-sponsor", companyName: "PT Cahaya Ilmu Nusantara" }, permissions: [...new Set(operations.map(o => o.action))] };
const envelope = (data: unknown) => ({ success: true, data, error: null, meta: Array.isArray(data) ? { page: 1, total: data.length, totalPages: 1 } : null });
const preset = (q: URLSearchParams) => (q.get("preset") === "30d" ? "30d" : "7d");
const FIXTURES: Record<string, (q: URLSearchParams) => unknown> = {
  "/auth/me": () => identity,
  "/notifications/unread-count": () => ({ total: 0 }),
  "/sponsor/profile": () => ({ ...demoSponsorProfile(), status: "PENDING" }),
  "/sponsor/balance": () => ({ ...demoBalance(), balance: 60_000, estimatedClicksRemaining: 120, pendingTopUps: 0 }),
  "/sponsor/ads": () => demoSponsorAds(),
  "/sponsor/analytics/summary": q => demoAnalyticsSummary(preset(q)),
  "/sponsor/analytics/timeseries": q => demoAnalyticsSeries(preset(q)),
  "/sponsor/analytics/breakdown": q => demoAnalyticsBreakdown(q.get("dimension") === "province" ? "province" : "device", preset(q)),
  "/sponsor/analytics/ads": q => demoAdPerformance(preset(q)),
};

/** API tiruan; `failing` = jalur yang gagal (500) sampai `recover()` dipanggil (efek dev berjalan dua kali). */
async function mockSponsorApi(page: Page, failing: string | null = null) {
  const requested: string[] = [];
  let broken = failing;
  await page.route("**/api/web/**", route => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/web", "");
    requested.push(`${path}${url.search}`);
    if (path === broken) return route.fulfill({ status: 500, json: { success: false, data: null, error: { message: "Server sedang sibuk.", code: "INTERNAL" }, meta: null } });
    return route.fulfill({ json: envelope(FIXTURES[path]?.(url.searchParams) ?? []) });
  });
  return { requested, recover: () => { broken = null; } };
}

test("API: akun masih ditinjau, saldo menipis, dan query periode beranda", async ({ page }) => {
  const { requested } = await mockSponsorApi(page);
  await page.goto("/hub");
  await expect(page.getByRole("heading", { level: 1, name: /Selamat datang, Rizky/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Akun sedang ditinjau" })).toContainText("pengajuan iklan & top-up aktif setelah akun disetujui");
  await expect(page.locator(".sponsor-hero .hero-note.alert")).toContainText("Saldo mulai menipis");
  await expect(page.locator(".insight-block .stat-tile")).toHaveCount(4);
  expect(requested).toEqual(expect.arrayContaining(["/sponsor/analytics/summary?preset=7d", "/sponsor/analytics/timeseries?preset=30d", "/sponsor/analytics/ads?preset=7d&sort=clicks&limit=50"]));
});

test("API: analitik menampilkan galat lalu pulih lewat Coba lagi; filter dikirim sebagai query", async ({ page }) => {
  const { requested, recover } = await mockSponsorApi(page, "/sponsor/analytics/summary");
  await page.goto("/hub/analytics");
  const alert = page.getByRole("alert").filter({ hasText: "Server sedang sibuk." });
  await expect(alert).toBeVisible();
  await expect(page.locator(".insight-kpis .kpi-skeleton")).toHaveCount(6);
  recover();
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(alert).toHaveCount(0);
  await expect(page.locator(".insight-kpis .stat-tile strong").first()).not.toHaveText("");
  await page.getByRole("radiogroup", { name: "Periode" }).getByRole("radio", { name: "30 hari" }).click();
  await page.getByRole("combobox", { name: "Kampanye" }).selectOption("ad-bimbel");
  await expect.poll(() => requested).toContain("/sponsor/analytics/summary?preset=30d&adId=ad-bimbel");
  expect(requested).toContain("/sponsor/analytics/breakdown?dimension=province&preset=30d&adId=ad-bimbel");
});

test("beranda sponsor: sapaan, saldo, KPI 7 hari, grafik tren, kampanye aktif, dan pratinjau penempatan", async ({ page }) => {
  const apiCalls: string[] = [];
  page.on("request", request => { if (request.url().includes("/api/web/sponsor")) apiCalls.push(request.url()); });
  await demoSponsor(page);
  await page.goto("/hub");
  await expect(page.getByRole("heading", { level: 1, name: /Selamat datang, Rizky/ })).toBeVisible();
  const hero = page.locator(".sponsor-hero");
  await expect(hero.getByRole("heading", { name: "Saldo iklan" })).toBeVisible();
  await expect(hero.locator(".hero-value")).toContainText("Rp");
  await expect(hero).toContainText("klik lagi");
  await expect(hero.getByRole("link", { name: "Isi saldo" })).toHaveAttribute("href", "/hub/balance");
  await expect(hero.getByRole("link", { name: "Buat kampanye" })).toHaveAttribute("href", "/hub/campaigns?baru=1");
  await expect(hero).toContainText("1 top-up menunggu verifikasi");

  const kpis = page.locator(".insight-block .stat-tile");
  await expect(kpis).toHaveCount(4);
  for (const name of ["Tayangan", "Klik", "CTR", "Biaya"]) await expect(page.locator(".insight-block")).toContainText(name);
  await expect(page.locator(".insight-block").getByText("vs 7 hari sebelumnya").first()).toBeVisible();
  await expect(page.locator(".insight-block .sparkline").first()).toBeVisible();

  await expect(page.getByRole("heading", { name: "Tren 30 hari" })).toBeVisible();
  await expect(page.locator(".trend-row .chart-canvas svg")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Kampanye aktif" })).toBeVisible();
  await expect(page.locator(".live-item")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Di mana iklan Anda tampil?" })).toBeVisible();
  await expect(page.locator(".placement-panel .phone .ad-card")).toBeVisible();
  await expect(page.locator(".placement-panel")).toContainText("Tidak pernah tampil di halaman absensi, rapor, maupun tagihan.");
  expect(apiCalls, "mode demo tidak memanggil API sponsor").toEqual([]);
});

test("beranda sponsor: tooltip tren muncul saat hover dan memuat metrik lain hari itu", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub");
  const panel = page.locator(".trend-row .insight-panel");
  const pointer = panel.locator(".chart-pointer");
  await expect(pointer).toBeVisible();
  const box = await pointer.boundingBox();
  if (!box) throw new Error("Area grafik tidak ditemukan.");
  await pointer.hover({ position: { x: box.width * 0.6, y: box.height / 2 } });
  const tooltip = panel.locator(".chart-tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("Tayangan");
  await expect(tooltip.locator(".chart-tooltip-foot")).toContainText(/Klik \d+ · CTR/);
  await panel.getByRole("radio", { name: "Biaya" }).click();
  await pointer.hover({ position: { x: box.width * 0.55, y: box.height / 2 } });
  await expect(tooltip).toContainText("Rp");
  await expect(tooltip.locator(".chart-tooltip-foot")).toContainText("klik ditagih");
});

test("analitik sponsor: ganti periode 30 hari & metrik, pilih iklan dari tabel, dan periode kosong", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub/analytics");
  await expect(page.getByRole("heading", { level: 1, name: "Analitik" })).toBeVisible();
  await expect(page.locator(".insight-kpis .stat-tile")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Tren 7 hari terakhir" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Periode" }).getByRole("radio", { name: "30 hari" }).click();
  await expect(page.getByRole("heading", { name: "Tren 30 hari terakhir" })).toBeVisible();
  await expect(page.locator(".insight-range")).toContainText("vs 30 hari sebelumnya");
  const metric = page.getByRole("radiogroup", { name: "Metrik grafik tren" });
  await metric.getByRole("radio", { name: "Klik" }).click();
  await expect(metric.getByRole("radio", { name: "Klik" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator(".sponsor-analytics .chart-canvas svg").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Klik per perangkat" })).toContainText("Ponsel");
  await expect(page.getByRole("list", { name: "Klik per provinsi" })).toContainText("DKI Jakarta");

  const rows = page.locator(".perf-table tbody tr");
  await expect(rows).toHaveCount(5);
  await page.getByRole("radiogroup", { name: "Urutkan tabel menurut" }).getByRole("radio", { name: "Biaya" }).click();
  await expect(page.locator(".perf-table thead th.sorted")).toHaveText("Biaya");
  await page.getByRole("button", { name: /Tryout UTBK gratis setiap Sabtu/ }).click();
  await expect(page.getByRole("combobox", { name: "Kampanye" })).toHaveValue("ad-tryout");
  await expect(page.getByRole("button", { name: /Tryout UTBK gratis setiap Sabtu/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("combobox", { name: "Kampanye" }).selectOption("ad-beasiswa");
  await expect(page.getByRole("heading", { name: "Belum ada data pada periode ini" })).toBeVisible();
  await page.getByRole("combobox", { name: "Kampanye" }).selectOption("");
  await expect(page.getByRole("heading", { name: "Belum ada data pada periode ini" })).toHaveCount(0);
});

test("beranda & analitik sponsor tanpa overflow horizontal di layar 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demoSponsor(page);
  await page.goto("/hub");
  await expect(page.locator(".sponsor-hero .hero-value")).toBeVisible();
  await expect(page.locator(".trend-row .chart-canvas svg")).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  await page.goto("/hub/analytics");
  await expect(page.locator(".insight-kpis .stat-tile")).toHaveCount(6);
  await expect(page.locator(".perf-table tbody tr").first()).toBeVisible();
  expect(await noOverflow(page)).toBe(true);
  // Label sumbu-x grafik 30 hari tidak bertumpuk di HP.
  await page.getByRole("radiogroup", { name: "Periode" }).getByRole("radio", { name: "30 hari" }).click();
  const labels = page.locator(".sponsor-analytics .chart-x text");
  await expect(labels.first()).toBeVisible();
  const boxes = await labels.evaluateAll(els => els.filter(e => e.textContent).map(e => { const r = e.getBoundingClientRect(); return [r.left, r.right]; }));
  boxes.slice(1).forEach(([left], i) => expect(left, "label sumbu-x tidak bertumpuk").toBeGreaterThanOrEqual(boxes[i]![1]!));
});
