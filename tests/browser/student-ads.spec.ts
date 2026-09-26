import { expect, test, type Page } from "@playwright/test";

/** Slot iklan beranda siswa: tampil tenang di bawah menu, impresi tercatat saat terlihat, klik membuka tab mitra. */
const envelope = (data: unknown) => ({ success: true, data, error: null, meta: null });
const student = { user: { id: "stu1", name: "Alya Putri Ramadhani", email: null, role: "STUDENT", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [] };
const ADS = [
  { token: "tok-bimbel-12345678901234", adId: "ad1", title: "Belajar 20 menit sehari bersama Bimbel Cahaya", imageUrl: "/demo/ads/bimbel-cahaya.svg", targetUrl: "https://mitra.example/bimbel", linkType: "EXTERNAL_URL", sponsorName: "PT Cahaya Ilmu Nusantara" },
  { token: "tok-pena-123456789012345", adId: "ad2", title: "Diskon 20% alat tulis sekolah", imageUrl: "/demo/ads/pena-alat-tulis.svg", targetUrl: "https://mitra.example/pena", linkType: "EXTERNAL_URL", sponsorName: "Toko Buku Pena Nusantara" },
];

async function mockStudent(page: Page, calls: string[]) {
  await page.route("**/api/web/**", async route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    if (route.request().method() === "POST") calls.push(`${path} ${route.request().postData() ?? ""}`);
    if (path === "/auth/me") return route.fulfill({ json: envelope(student) });
    if (path === "/student/ads") return route.fulfill({ json: envelope({ ads: ADS, refreshAfterSeconds: 1800 }) });
    if (path === "/student/ads/impressions") return route.fulfill({ json: envelope({ accepted: 1, duplicate: 0, rejected: 0 }) });
    if (path === "/student/ads/clicks") return route.fulfill({ json: envelope({ targetUrl: "https://mitra.example/bimbel", linkType: "EXTERNAL_URL" }) });
    if (path === "/student/profile") return route.fulfill({ json: envelope({ className: "X IPA 1" }) });
    return route.fulfill({ json: envelope([]) });
  });
}

test("demo siswa: slot mitra tenang di bawah menu, berlabel Sponsor, bisa digeser, dengan penjelasan", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => { sessionStorage.setItem("studenthub_demo", "true"); sessionStorage.setItem("studenthub_demo_role", "STUDENT"); });
  const page = await context.newPage();
  await page.goto("/hub");
  const slot = page.getByRole("region", { name: "Info dari mitra" });
  await expect(slot).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Menu siswa" }).getByRole("link")).toHaveCount(6);
  // Urutan: menu -> slot mitra -> pengumuman.
  const order = await page.evaluate(() => ["nav.tile-grid", ".partner-slot", "#news-title"].map(sel => document.querySelector(sel)!.getBoundingClientRect().top));
  expect(order[0]! < order[1]! && order[1]! < order[2]!).toBe(true);
  await expect(slot.locator(".ad-badge").first()).toHaveText(/sponsor/i);
  await expect(slot.getByRole("group")).toHaveCount(4);
  await page.getByRole("button", { name: "Kenapa ada ini?" }).click();
  await expect(page.getByText("bukan dari data pribadimu", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Tampilkan info mitra 3" }).click();
  await expect(page.getByRole("button", { name: "Tampilkan info mitra 3" })).toHaveAttribute("aria-current", "true");
  await slot.getByRole("button", { name: /Sponsor Toko Buku Pena Nusantara/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Mode demo" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.close();
});

test("siswa: impresi terkirim setelah kartu terlihat; klik mengirim impresi dulu lalu membuka tab mitra", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("https://mitra.example/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Mitra</h1>" }));
  const page = await context.newPage();
  const calls: string[] = [];
  await mockStudent(page, calls);
  await page.goto("/hub");
  const slot = page.getByRole("region", { name: "Info dari mitra" });
  await slot.scrollIntoViewIfNeeded();
  await expect.poll(() => calls.find(c => c.startsWith("/student/ads/impressions")) ?? "", { timeout: 10_000 }).toContain("tok-bimbel-12345678901234");
  const popup = context.waitForEvent("page");
  await slot.getByRole("button", { name: /Sponsor PT Cahaya Ilmu Nusantara/ }).click();
  const tab = await popup;
  await expect.poll(() => tab.url()).toBe("https://mitra.example/bimbel");
  const click = calls.find(c => c.startsWith("/student/ads/clicks")) ?? "";
  expect(click).toContain("tok-bimbel-12345678901234");
  expect(click, "jendela 390px dilaporkan sebagai ponsel").toContain("\"deviceType\":\"MOBILE\"");
  const impressionAt = calls.findIndex(c => c.startsWith("/student/ads/impressions"));
  expect(impressionAt).toBeGreaterThanOrEqual(0);
  expect(impressionAt).toBeLessThan(calls.findIndex(c => c.startsWith("/student/ads/clicks")));
  await context.close();
});

test("siswa: impresi yang gagal (502) dikirim ulang; klik tetap mengirim impresi segar untuk kartu itu", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("https://mitra.example/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Mitra</h1>" }));
  const page = await context.newPage();
  const calls: string[] = [];
  await mockStudent(page, calls);
  let failures = 1;
  await page.route("**/api/web/student/ads/impressions", route => {
    calls.push(`/student/ads/impressions ${route.request().postData() ?? ""}`);
    if (failures-- > 0) return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502</h1>" });
    return route.fulfill({ json: envelope({ accepted: 1, duplicate: 0, rejected: 0 }) });
  });
  await page.goto("/hub");
  const slot = page.getByRole("region", { name: "Info dari mitra" });
  await slot.scrollIntoViewIfNeeded();
  await expect.poll(() => calls.filter(c => c.startsWith("/student/ads/impressions") && c.includes("tok-bimbel")).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const before = calls.filter(c => c.startsWith("/student/ads/impressions")).length;
  const popup = context.waitForEvent("page");
  await slot.getByRole("button", { name: /Sponsor PT Cahaya Ilmu Nusantara/ }).click();
  await popup;
  const after = calls.filter(c => c.startsWith("/student/ads/impressions"));
  expect(after.length, "impresi segar dikirim sebelum klik").toBeGreaterThan(before);
  expect(after.at(-1)).toContain("tok-bimbel-12345678901234");
  await context.close();
});

test("siswa: tidak ada iklan -> slot tidak dirender sama sekali", async ({ page }) => {
  const calls: string[] = [];
  await mockStudent(page, calls);
  await page.route("**/api/web/student/ads", route => route.fulfill({ json: envelope({ ads: [], refreshAfterSeconds: 1800 }) }));
  await page.goto("/hub");
  await expect(page.getByRole("navigation", { name: "Menu siswa" })).toBeVisible();
  await expect(page.locator(".partner-slot")).toHaveCount(0);
});
