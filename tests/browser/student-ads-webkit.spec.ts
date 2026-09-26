import { devices, expect, test } from "@playwright/test";

/** Safari iPhone: tab mitra dibuka sinkron saat klik lalu diarahkan setelah API klik — tidak diblokir popup blocker. */
test.use({ ...devices["iPhone 13"], browserName: "webkit", launchOptions: {} });

const envelope = (data: unknown) => ({ success: true, data, error: null, meta: null });
const student = { user: { id: "stu1", name: "Alya Putri Ramadhani", email: null, role: "STUDENT", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [] };
const AD = { token: "tok-bimbel-12345678901234", adId: "ad1", title: "Belajar 20 menit sehari bersama Bimbel Cahaya", imageUrl: "/demo/ads/bimbel-cahaya.svg", targetUrl: "https://mitra.example/bimbel", linkType: "EXTERNAL_URL", sponsorName: "PT Cahaya Ilmu Nusantara" };

test("iPhone (WebKit): ketuk kartu mitra membuka tab baru ke tautan mitra", async ({ page, context }) => {
  await context.route("https://mitra.example/**", route => route.fulfill({ contentType: "text/html", body: "<h1>Mitra</h1>" }));
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    if (path === "/auth/me") return route.fulfill({ json: envelope(student) });
    if (path === "/student/ads") return route.fulfill({ json: envelope({ ads: [AD], refreshAfterSeconds: 1800 }) });
    if (path === "/student/ads/impressions") return route.fulfill({ json: envelope({ accepted: 1, duplicate: 0, rejected: 0 }) });
    if (path === "/student/ads/clicks") return route.fulfill({ json: envelope({ targetUrl: AD.targetUrl, linkType: "EXTERNAL_URL" }) });
    return route.fulfill({ json: envelope([]) });
  });
  await page.goto("/hub");
  const card = page.getByRole("region", { name: "Info dari mitra" }).getByRole("button", { name: /Sponsor PT Cahaya Ilmu Nusantara/ });
  await card.scrollIntoViewIfNeeded();
  const popup = context.waitForEvent("page");
  await card.tap();
  const tab = await popup;
  await expect.poll(() => tab.url(), { timeout: 10_000 }).toBe(AD.targetUrl);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
