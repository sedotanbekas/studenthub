import { expect, test, type Page } from "@playwright/test";

/** Kehadiran admin sekolah (mode demo): peta check-in berkelompok, sebaran pin, daftar tersinkron, tab data lengkap. */

async function openAsSchoolAdmin(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("studenthub_demo", "true");
    sessionStorage.setItem("studenthub_demo_role", "SCHOOL_ADMIN");
  });
  await page.goto("/hub/attendance");
  await expect(page.getByRole("heading", { level: 1, name: "Kehadiran" })).toBeVisible();
  await expect(page.locator(".monitor-map-box .leaflet-container")).toBeVisible();
}

const clusters = (page: Page) => page.getByRole("button", { name: /^\d+ siswa$/ });

/** Klik kelompok terbesar sampai tersebar (zoom dulu bila anggotanya masih bisa dipisah). */
async function spiderfyLargest(page: Page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await expect(clusters(page).first()).toBeVisible();
    const labels = await clusters(page).evaluateAll(els => els.map(el => Number.parseInt(el.getAttribute("aria-label") ?? "0", 10)));
    await clusters(page).nth(labels.indexOf(Math.max(...labels))).click();
    await page.waitForTimeout(900);
    if (await page.locator(".spider-pin").count()) return;
  }
  throw new Error("Kelompok tidak pernah tersebar.");
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("peta: kelompok berjumlah tampil, kelompok bertumpuk menyebar, zoom menguncupkan", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await openAsSchoolAdmin(page);
  await expect(page.getByRole("tab", { name: "Peta & daftar" })).toHaveAttribute("aria-selected", "true");
  await expect(clusters(page).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Legenda peta" })).toContainText("2 di luar radius");

  await spiderfyLargest(page);
  expect(await page.locator(".spider-pin").count()).toBeGreaterThanOrEqual(8);
  await expect(page.locator(".att-cluster-icon[aria-expanded='true']")).toHaveCount(1);
  await page.locator(".spider-pin").first().click();
  await expect(page.locator(".leaflet-popup-content")).toContainText("Lihat detail");

  await page.getByRole("button", { name: "Zoom out" }).click();
  await expect(page.locator(".spider-pin")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("daftar: klik baris memfokuskan pin (sebar tumpukan) dan membuka popup + detail", async ({ page }) => {
  await openAsSchoolAdmin(page);
  const located = page.getByRole("list", { name: "Siswa dengan lokasi" });
  const row = located.getByRole("button", { name: /Wulan Dari/ });
  await row.click();
  await expect(page.locator(".leaflet-popup-content")).toContainText("Wulan Dari");
  await expect(page.locator(".leaflet-popup-content")).toContainText("HP dipakai siswa lain");
  await expect(row).toHaveAttribute("aria-current", "true");
  expect(await page.locator(".spider-pin").count(), "8 siswa berkoordinat sama tersebar").toBeGreaterThanOrEqual(8);
  await expect(page.locator(".att-pin-icon.is-selected")).toHaveCount(1);

  await page.locator(".leaflet-popup-content").getByRole("button", { name: "Lihat detail" }).click();
  const dialog = page.getByRole("dialog", { name: "Wulan Dari" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Foto contoh");
  await expect(dialog).toContainText("Perangkat yang sama dipakai siswa lain hari ini");
  await dialog.getByRole("button", { name: "Selesai" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("filter: chip status & cari memfilter peta dan daftar; counts dari data", async ({ page }) => {
  await openAsSchoolAdmin(page);
  const located = page.getByRole("list", { name: "Siswa dengan lokasi" });
  await expect(located.getByRole("listitem")).toHaveCount(33);
  const late = page.getByRole("button", { name: "Terlambat (6)" });
  await late.click();
  await expect(late).toHaveAttribute("aria-pressed", "true");
  await expect(located.getByRole("listitem")).toHaveCount(6);
  await expect(page.getByRole("list", { name: "Siswa tanpa lokasi" })).toHaveCount(0);
  await page.getByRole("button", { name: "Semua status (43)" }).click();
  await page.getByRole("searchbox", { name: "Cari nama atau NIS" }).fill("citra");
  await expect(located.getByRole("listitem")).toHaveCount(1);
  await expect(located).toContainText("Citra Ayu Lestari");
  await expect(page.locator(".monitor-map-box .att-pin-icon")).toHaveCount(1);
});

test("tab Data lengkap menampilkan tabel kehadiran lama", async ({ page }) => {
  await openAsSchoolAdmin(page);
  await page.getByRole("tab", { name: "Data lengkap" }).click();
  await expect(page.getByRole("tab", { name: "Data lengkap" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel").locator("table")).toBeVisible();
  expect(await page.getByRole("tabpanel").locator("tbody tr").count()).toBeGreaterThan(0);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await page.getByRole("tab", { name: "Peta & daftar" }).click();
  await expect(page.locator(".monitor-map-box .leaflet-container")).toBeVisible();
});

test("HP 390x844: tanpa luapan horizontal; klik baris menggulir peta ke tampilan", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAsSchoolAdmin(page);
  await expect(clusters(page).first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await spiderfyLargest(page);
  expect(await noHorizontalOverflow(page)).toBe(true);

  const row = page.getByRole("list", { name: "Siswa dengan lokasi" }).getByRole("button", { name: /Teguh Santoso/ });
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await row.click();
  await expect(page.locator(".leaflet-popup-content")).toContainText("Teguh Santoso");
  await expect(page.locator(".monitor-map-box")).toBeInViewport({ ratio: 0.5 });
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("HP 320x640: popup pin muat di peta (tombol tutup & 'Lihat detail' terlihat)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openAsSchoolAdmin(page);
  const row = page.getByRole("list", { name: "Siswa dengan lokasi" }).getByRole("button", { name: /Wulan Dari/ });
  await row.scrollIntoViewIfNeeded();
  await row.click();
  const popup = page.locator(".monitor-popup");
  await expect(popup).toContainText("HP dipakai siswa lain");
  await page.waitForTimeout(700); // geser otomatis agar popup masuk tampilan
  const map = (await page.locator(".monitor-map-box").boundingBox())!;
  const inside = async (selector: string) => {
    const box = (await popup.locator(selector).boundingBox())!;
    expect(box.x, selector).toBeGreaterThanOrEqual(map.x);
    expect(box.x + box.width, selector).toBeLessThanOrEqual(map.x + map.width);
    expect(box.y, selector).toBeGreaterThanOrEqual(map.y);
  };
  await inside(".leaflet-popup-content-wrapper");
  await inside(".leaflet-popup-close-button");
  const detail = popup.getByRole("button", { name: "Lihat detail" });
  await inside(".pin-card-detail");
  expect(await noHorizontalOverflow(page)).toBe(true);
  await detail.click();
  await expect(page.getByRole("dialog", { name: "Wulan Dari" })).toBeVisible();
});

test("peta dibongkar saat animasi zoom berjalan tanpa galat", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await openAsSchoolAdmin(page);
  await expect(clusters(page).first()).toBeVisible();
  // Zoom dimulai pada frame berikutnya (animasi 250 ms); tab ganti -> peta dibongkar di tengah animasi.
  await page.evaluate(() => new Promise<void>(resolve => {
    document.querySelector<HTMLElement>(".leaflet-control-zoom-in")?.click();
    requestAnimationFrame(() => requestAnimationFrame(() => { document.getElementById("monitor-tab-data")?.click(); resolve(); }));
  }));
  await expect(page.getByRole("tab", { name: "Data lengkap" })).toHaveAttribute("aria-selected", "true");
  await page.waitForTimeout(700);
  expect(errors).toEqual([]);
});

test("modul peta gagal dimuat -> pesan + 'Coba lagi' memuat ulang peta", async ({ page }) => {
  let blocked = true;
  await page.route(/leaflet-src.*\.js/, route => (blocked ? route.abort() : route.continue()));
  await page.addInitScript(() => {
    sessionStorage.setItem("studenthub_demo", "true");
    sessionStorage.setItem("studenthub_demo_role", "SCHOOL_ADMIN");
  });
  await page.goto("/hub/attendance");
  const box = page.locator(".monitor-map-box");
  await expect(box.getByRole("alert")).toContainText("Peta belum berhasil dimuat");
  blocked = false;
  await box.getByRole("button", { name: "Coba lagi" }).click();
  await expect(box.locator(".leaflet-container")).toBeVisible();
  await expect(box.getByRole("alert")).toHaveCount(0);
  await expect(clusters(page).first()).toBeVisible();
});

test("desktop: baris terpilih digulir sampai lepas dari label sticky daftar", async ({ page }) => {
  await openAsSchoolAdmin(page);
  const scroller = page.locator(".monitor-list-scroll");
  const row = page.getByRole("list", { name: "Siswa dengan lokasi" }).locator(".monitor-row").nth(12);
  // Letakkan baris 10px di bawah tepi atas daftar = tertutup label sticky (dua kali: tinggi baris content-visibility menyesuaikan).
  for (let i = 0; i < 2; i++) {
    await row.evaluate(el => {
      const box = el.closest(".monitor-list-scroll")!;
      box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 10;
    });
    await page.waitForTimeout(100);
  }
  const labelBottom = () => page.locator(".monitor-list-label").first().evaluate(el => el.getBoundingClientRect().bottom);
  const rowTop = () => row.evaluate(el => el.getBoundingClientRect().top);
  expect(await rowTop()).toBeLessThan(await labelBottom());
  await row.dispatchEvent("click");
  await expect(row).toHaveAttribute("aria-current", "true");
  await expect.poll(async () => (await rowTop()) - (await labelBottom())).toBeGreaterThanOrEqual(0);
  expect(await scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
});
