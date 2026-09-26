import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { addDays, demoAnalyticsSeries, demoAnalyticsSummary, demoBalance, wibToday } from "../../src/lib/frontend/demo-ads";

/**
 * Halaman sponsor "Kampanye saya" (daftar, detail + pratinjau, editor dengan pratinjau langsung, ?baru=1)
 * dan "Saldo & top-up" (rekening, formulir bukti, riwayat). Mode demo tidak memanggil API; dua test
 * terakhir memakai API tiruan untuk mengunci bentuk body sesuai kontrak strict.
 */
async function demoSponsor(page: Page) {
  await page.addInitScript(() => { sessionStorage.setItem("studenthub_demo", "true"); sessionStorage.setItem("studenthub_demo_role", "SPONSOR"); });
}

/** PNG buatan kanvas (bukan berkas di repo) untuk menguji cek rasio banner / bukti transfer. */
async function pngOf(page: Page, width: number, height: number): Promise<Buffer> {
  const base64 = await page.evaluate(([w, h]) => {
    const canvas = document.createElement("canvas");
    canvas.width = w!; canvas.height = h!;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#1d4ed8"; ctx.fillRect(0, 0, w!, h!);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, [width, height]);
  return Buffer.from(base64, "base64");
}

const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("demo sponsor: daftar kampanye, filter, detail dengan pratinjau & aksi jeda", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await demoSponsor(page);
  await page.goto("/hub/campaigns");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kampanye saya");
  const list = page.getByRole("list", { name: "Daftar kampanye" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await page.getByRole("button", { name: /^Tayang/ }).click();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await list.getByRole("button", { name: "Tryout UTBK gratis setiap Sabtu" }).click();
  const dialog = page.getByRole("dialog", { name: "Tryout UTBK gratis setiap Sabtu" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".placement-preview .ad-title")).toHaveText("Tryout UTBK gratis setiap Sabtu");
  await expect(dialog.getByRole("heading", { name: "7 hari terakhir" })).toBeVisible();
  await expect(dialog.getByRole("figure", { name: /Klik per hari/ })).toBeVisible();
  await dialog.getByRole("button", { name: "Jeda penayangan" }).click();
  await expect(dialog.locator(".detail-status .status")).toHaveText("Dijeda");
  await expect(dialog.getByRole("button", { name: "Lanjutkan penayangan" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Mode demo" })).toBeVisible();
  await dialog.getByRole("button", { name: "Tutup detail" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("demo sponsor: editor lewat tombol — pratinjau langsung mengikuti judul, validasi, simpan draf", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub/campaigns");
  await page.getByRole("button", { name: "Buat kampanye" }).click();
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await expect(editor).toBeVisible();
  const previewTitle = editor.locator(".placement-preview .ad-title");
  await expect(previewTitle).toHaveText("Judul kampanye Anda");
  await editor.getByRole("button", { name: "Simpan & ajukan tinjauan" }).click();
  await expect(editor.getByText("Pilih banner kampanye.")).toBeVisible();
  await expect(editor.getByText(/Periksa \d isian/)).toBeVisible();
  await editor.getByLabel("Judul kampanye").fill("Kelas menulis kreatif untuk SMA");
  await expect(previewTitle).toHaveText("Kelas menulis kreatif untuk SMA");
  await expect(editor.getByText("31/100")).toBeVisible();
  await editor.getByRole("button", { name: "Pakai banner contoh" }).click();
  await editor.getByLabel("Tautan tujuan").fill("cahayailmu.example/menulis");
  await editor.getByLabel("Tautan tujuan").blur();
  await expect(editor.getByLabel("Tautan tujuan")).toHaveValue("https://cahayailmu.example/menulis");
  await editor.getByRole("radio", { name: /Provinsi/ }).check();
  await editor.getByRole("combobox").filter({ hasText: "Tambah provinsi" }).selectOption({ label: "DKI Jakarta" });
  await expect(editor.getByRole("button", { name: "Hapus DKI Jakarta" })).toBeVisible();
  await editor.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "Mode demo: draf kampanye tersimpan" })).toBeVisible();
  const card = page.getByRole("list", { name: "Daftar kampanye" }).getByRole("listitem").first();
  await expect(card).toContainText("Kelas menulis kreatif untuk SMA");
  await expect(card).toContainText("Draf");
  await expect(card).toContainText("DKI Jakarta");
});

test("demo sponsor: ?baru=1 membuka editor dan alamat dibersihkan; banner dicek di klien", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub/campaigns?baru=1");
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(/\/hub\/campaigns$/);
  await editor.locator("#campaign-banner").setInputFiles({ name: "kotak.png", mimeType: "image/png", buffer: await pngOf(page, 1000, 1000) });
  await expect(editor.getByText(/Rasio banner harus 2:1 — gambar ini 1000×1000/)).toBeVisible();
  await editor.locator("#campaign-banner").setInputFiles({ name: "IMG_1.HEIC", mimeType: "image/heic", buffer: Buffer.from("heic") });
  await expect(editor.getByText(/HEIC/).first()).toBeVisible();
  await editor.locator("#campaign-banner").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: await pngOf(page, 1200, 600) });
  await expect(editor.getByText("Mode demo: banner tidak diunggah, hanya dipratinjau di perangkat ini.")).toBeVisible();
  await expect(editor.locator(".placement-preview .ad-media img")).toHaveAttribute("src", /^blob:/);
});

test("demo sponsor: saldo — rekening tampil, kirim top-up menambah baris Menunggu", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub/balance");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Saldo & top-up");
  await expect(page.getByText("1234 5678 90")).toBeVisible();
  await expect(page.getByText("a.n. PT Student Hub Indonesia")).toBeVisible();
  const pending = page.locator(".topup-row").filter({ hasText: "Menunggu" });
  await expect(pending).toHaveCount(1);
  await page.getByRole("button", { name: "Kirim bukti top-up" }).click();
  await expect(page.getByText("Isi nominal top-up.")).toBeVisible();
  await page.getByRole("button", { name: "500 rb" }).click();
  await expect(page.getByLabel("Nominal transfer")).toHaveValue("500.000");
  await page.getByLabel("Bank pengirim").fill("BCA");
  await page.getByLabel("Nama pemilik rekening pengirim").fill("PT Cahaya Ilmu Nusantara");
  await page.locator("#topup-file").setInputFiles({ name: "IMG_2.heic", mimeType: "image/heic", buffer: Buffer.from("heic") });
  await expect(page.locator("#topup-file-error")).toContainText("HEIC");
  await page.locator("#topup-file").setInputFiles({ name: "bukti.png", mimeType: "image/png", buffer: await pngOf(page, 600, 900) });
  await page.getByRole("button", { name: "Kirim bukti top-up" }).click();
  await expect(pending).toHaveCount(2);
  await expect(pending.first()).toContainText(/Rp\s500\.000/);
  await expect(page.locator(".hero-chip")).toHaveText("2 top-up menunggu verifikasi");
  await expect(page.getByLabel("Nominal transfer")).toHaveValue("");
});

/** Isi input date lewat setter asli (Playwright `fill` menolak tahun 5 digit yang bisa diketik pengguna). */
async function setDateValue(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("demo sponsor: tahun 5 digit di jadwal tidak membuat editor crash; pesan Tanggal tidak valid", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await demoSponsor(page);
  await page.goto("/hub/campaigns");
  await page.getByRole("button", { name: "Buat kampanye" }).click();
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await expect(editor.locator("#campaign-end")).toHaveAttribute("max", "9999-12-31");
  await setDateValue(page, "#campaign-end", "20261-01-01");
  await expect(editor.locator("#campaign-end")).toHaveValue("20261-01-01");
  await expect(editor.locator("#campaign-schedule-error")).toContainText("Tanggal tidak valid");
  await expect(editor.locator("#campaign-end")).toHaveAttribute("aria-invalid", "true");
  await editor.getByRole("button", { name: "7 hari" }).click();
  await expect(editor.locator("#campaign-schedule-error")).toHaveCount(0);
  await expect(editor.locator("#campaign-schedule-hint")).toContainText("7 hari tayang");
  await setDateValue(page, "#campaign-schedule", "20261-01-01");
  await expect(editor.getByRole("button", { name: "7 hari" })).toBeDisabled();
  await editor.getByRole("button", { name: "Simpan draf" }).click();
  await expect(editor.locator("#campaign-schedule-error")).toContainText("Tanggal tidak valid");
  await expect(editor).toBeVisible();
  expect(errors).toEqual([]);
});

test("demo sponsor: dialog yang tertutup native (Escape ganda Chrome) bisa dibuka lagi", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub/campaigns");
  const card = page.getByRole("list", { name: "Daftar kampanye" }).getByRole("button", { name: "Tryout UTBK gratis setiap Sabtu" });
  await card.click();
  const detail = page.getByRole("dialog", { name: "Tryout UTBK gratis setiap Sabtu" });
  await expect(detail).toBeVisible();
  await detail.evaluate(el => (el as HTMLDialogElement).close());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.click();
  await expect(detail).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Buat kampanye" }).click();
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await expect(editor).toBeVisible();
  await editor.evaluate(el => (el as HTMLDialogElement).close());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Buat kampanye" }).click();
  await expect(editor).toBeVisible();
});

test("demo sponsor: nominal tempelan Rp500.000,00 menjadi 500.000 (bukan 100×)", async ({ page }) => {
  await demoSponsor(page);
  await page.goto("/hub/balance");
  await page.getByLabel("Nominal transfer").fill("Rp500.000,00");
  await expect(page.getByLabel("Nominal transfer")).toHaveValue("500.000");
});

test("HP 390px: kampanye, editor layar penuh, dan saldo tanpa luapan horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demoSponsor(page);
  await page.goto("/hub/campaigns");
  await expect(page.getByRole("list", { name: "Daftar kampanye" }).getByRole("listitem").first()).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.getByRole("button", { name: "Buat kampanye" }).click();
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await expect(editor).toBeVisible();
  expect(await editor.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await editor.getByRole("button", { name: "Tutup editor" }).click();
  await page.getByRole("list", { name: "Daftar kampanye" }).getByRole("button").first().click();
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.goto("/hub/balance");
  await expect(page.getByText("1234 5678 90")).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

// ----------------------------------------------------------------------------- kontrak API (tiruan)

const identity = { user: { id: "sponsor-user", name: "Rizky Pratama", email: "rizky@example.test", role: "SPONSOR", mustChangePassword: false, totpEnrollmentRequired: false }, school: null, sponsor: { id: "sp1", companyName: "PT Cahaya Ilmu" }, permissions: [...new Set(operations.map(o => o.action))] };
const envelope = (data: unknown, meta: unknown = { page: 1, total: 0, totalPages: 1 }) => ({ success: true, data, error: null, meta });
const profile = { id: "sp1", companyName: "PT Cahaya Ilmu", contactName: "Rizky", contactEmail: "rizky@example.test", contactPhone: "0812", address: null, status: "APPROVED", statusReason: null, reviewedAt: null, balance: 100_000, createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z" };

async function mockSponsorApi(page: Page, handle: (path: string, method: string) => unknown) {
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    const custom = handle(path, route.request().method());
    const data = custom !== undefined ? custom : path === "/auth/me" ? identity : path === "/sponsor/profile" ? profile : path === "/sponsor/balance" ? demoBalance() : path === "/sponsor/analytics/summary" ? demoAnalyticsSummary("7d") : path === "/notifications/unread-count" ? { total: 0 } : [];
    return route.fulfill({ status: route.request().method() === "POST" && custom !== undefined ? 201 : 200, json: envelope(data) });
  });
}

test("API: editor mengirim POST /sponsor/ads persis kontrak lalu mengajukan tinjauan", async ({ page }) => {
  const today = wibToday();
  let created: Record<string, unknown> | undefined;
  let submitted = false;
  const ad = (status: string) => ({ id: "ad_new1", sponsorId: "sp1", title: "Kelas menulis kreatif", imageFileId: "file_banner1", imageUrl: null, linkType: "EXTERNAL_URL", targetUrl: "https://cahayailmu.example/menulis", startAt: `${today}T00:00:00+07:00`, endAt: `${addDays(today, 30)}T00:00:00+07:00`, status, displayStatus: status, isActive: false, targetScope: "ALL", targets: [], cpcAmount: 500, submittedAt: null, reviewNote: null, reviewedAt: null, createdAt: "2026-09-26T00:00:00Z", updatedAt: "2026-09-26T00:00:00Z" });
  await mockSponsorApi(page, (path, method) => {
    if (path === "/sponsor/banners" && method === "POST") return { fileId: "file_banner1", mimeType: "image/webp", width: 1200, height: 600, sizeBytes: 1000 };
    if (path === "/sponsor/ads" && method === "POST") return ad("DRAFT");
    if (path === "/sponsor/ads/ad_new1/submit" && method === "POST") { submitted = true; return ad("PENDING_REVIEW"); }
    return undefined;
  });
  page.on("request", request => { if (request.url().endsWith("/api/web/sponsor/ads") && request.method() === "POST") created = request.postDataJSON(); });
  await page.goto("/hub/campaigns");
  await page.getByRole("button", { name: "Buat kampanye pertama" }).click();
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await editor.locator("#campaign-banner").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: await pngOf(page, 1200, 600) });
  await expect(editor.getByText(/Banner siap \(1200×600 piksel\)/)).toBeVisible();
  await editor.getByLabel("Judul kampanye").fill("  Kelas   menulis kreatif ");
  await editor.getByLabel("Tautan tujuan").fill("https://cahayailmu.example/menulis");
  await editor.getByRole("button", { name: "Simpan & ajukan tinjauan" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kampanye diajukan untuk ditinjau." })).toBeVisible();
  expect(created).toEqual({ title: "Kelas menulis kreatif", imageFileId: "file_banner1", linkType: "EXTERNAL_URL", targetUrl: "https://cahayailmu.example/menulis", startAt: `${today}T00:00:00+07:00`, endAt: `${addDays(today, 30)}T00:00:00+07:00`, targetScope: "ALL" });
  expect(submitted).toBe(true);
  await expect(page.getByRole("list", { name: "Daftar kampanye" })).toContainText("Menunggu tinjauan");
});

test("API: top-up dikirim sebagai multipart dengan field kontrak saja (tanpa catatan kosong)", async ({ page }) => {
  let multipart = "";
  await mockSponsorApi(page, (path, method) => {
    if (path === "/sponsor/topups" && method === "POST") return { id: "tu_new", sponsorId: "sp1", amount: 750_000, transferDate: wibToday(), senderName: "PT Cahaya Ilmu", senderBank: "Mandiri", note: null, status: "PENDING", reviewNote: null, reviewedAt: null, proofFileId: "file_proof", createdAt: new Date().toISOString() };
    return undefined;
  });
  page.on("request", request => { if (request.url().endsWith("/api/web/sponsor/topups") && request.method() === "POST") multipart = request.postDataBuffer()?.toString("latin1") ?? ""; });
  await page.goto("/hub/balance");
  await page.getByLabel("Nominal transfer").fill("750000");
  await expect(page.getByLabel("Nominal transfer")).toHaveValue("750.000");
  await page.getByLabel("Bank pengirim").fill("Mandiri");
  await page.getByLabel("Nama pemilik rekening pengirim").fill("PT  Cahaya Ilmu");
  await page.locator("#topup-file").setInputFiles({ name: "bukti.png", mimeType: "image/png", buffer: await pngOf(page, 400, 600) });
  await page.getByRole("button", { name: "Kirim bukti top-up" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Bukti top-up terkirim" })).toBeVisible();
  const names = [...multipart.matchAll(/; name="([^"]+)"/g)].map(m => m[1]);
  expect(names).toEqual(["amount", "transferDate", "senderName", "senderBank", "file"]);
  expect(multipart).toContain('name="amount"\r\n\r\n750000\r\n');
  expect(multipart).toContain('name="senderName"\r\n\r\nPT Cahaya Ilmu\r\n');
  await expect(page.locator(".topup-row").first()).toContainText("Menunggu");
});

// ----------------------------------------------------------------------------- pemulihan & kasus tepi (API tiruan)

const apiError = (code: string, message: string) => ({ success: false, data: null, error: { code, message }, meta: null });

function apiAd(overrides: Record<string, unknown> = {}) {
  const today = wibToday();
  return {
    id: "ad_1", sponsorId: "sp1", title: "Kelas menulis kreatif", imageFileId: "file_banner1", imageUrl: null, linkType: "EXTERNAL_URL", targetUrl: "https://cahayailmu.example/menulis",
    startAt: `${today}T00:00:00+07:00`, endAt: `${addDays(today, 30)}T00:00:00+07:00`, status: "DRAFT", displayStatus: "DRAFT", isActive: false, targetScope: "ALL", targets: [],
    cpcAmount: 500, submittedAt: null, reviewNote: null, reviewedAt: null, createdAt: "2026-09-20T00:00:00Z", updatedAt: "2026-09-21T00:00:00.000Z", ...overrides,
  };
}

async function mockCampaignList(page: Page) {
  await mockSponsorApi(page, (path, method) => {
    if (path === "/sponsor/ads" && method === "GET") return [apiAd()];
    if (path === "/sponsor/analytics/timeseries") return demoAnalyticsSeries("7d");
    return undefined;
  });
}

test("API: STATE_CONFLICT saat simpan memuat versi terbaru ke daftar & draf, simpan ulang memakai updatedAt baru", async ({ page }) => {
  const patches: unknown[] = [];
  const latest = apiAd({ title: "Judul dari tab lain", updatedAt: "2026-09-26T02:00:00.000Z" });
  await mockCampaignList(page);
  await page.route("**/api/web/sponsor/ads/ad_1", route => {
    const method = route.request().method();
    if (method === "GET") return route.fulfill({ json: envelope(latest) });
    if (method !== "PATCH") return route.fallback();
    patches.push(route.request().postDataJSON());
    if (patches.length === 1) return route.fulfill({ status: 409, json: apiError("STATE_CONFLICT", "Iklan sudah diubah pihak lain.") });
    return route.fulfill({ json: envelope({ ad: { ...latest, targetUrl: "https://cahayailmu.example/baru", updatedAt: "2026-09-26T03:00:00.000Z" }, reReviewTriggered: false }) });
  });
  await page.goto("/hub/campaigns");
  await page.getByRole("list", { name: "Daftar kampanye" }).getByRole("button", { name: "Kelas menulis kreatif" }).click();
  await page.getByRole("dialog", { name: "Kelas menulis kreatif" }).getByRole("button", { name: "Ubah" }).click();
  const editor = page.locator("dialog.campaign-editor");
  await editor.getByLabel("Tautan tujuan").fill("https://cahayailmu.example/baru");
  await editor.getByRole("button", { name: "Simpan draf" }).click();
  await expect(editor.locator(".error-message")).toHaveText("Data kampanye berubah; kami memuat versi terbaru — periksa lalu simpan lagi.");
  await expect(editor.getByLabel("Judul kampanye")).toHaveValue("Judul dari tab lain");
  await expect(editor.getByLabel("Tautan tujuan")).toHaveValue("https://cahayailmu.example/baru");
  await expect(page.getByRole("list", { name: "Daftar kampanye" })).toContainText("Judul dari tab lain");
  await editor.getByRole("button", { name: "Simpan draf" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Perubahan disimpan." })).toBeVisible();
  expect(patches).toEqual([
    { targetUrl: "https://cahayailmu.example/baru", expectedUpdatedAt: "2026-09-21T00:00:00.000Z" },
    { targetUrl: "https://cahayailmu.example/baru", expectedUpdatedAt: "2026-09-26T02:00:00.000Z" },
  ]);
});

test("API: AD_INVALID_TRANSITION di detail memuat status terbaru sehingga aksi yang sah ikut berubah", async ({ page }) => {
  await mockCampaignList(page);
  await page.route("**/api/web/sponsor/ads/ad_1/submit", route => route.fulfill({ status: 409, json: apiError("AD_INVALID_TRANSITION", "Aksi ini tidak berlaku untuk status iklan saat ini.") }));
  await page.route("**/api/web/sponsor/ads/ad_1", route => route.fulfill({ json: envelope(apiAd({ status: "PENDING_REVIEW", displayStatus: "PENDING_REVIEW", submittedAt: "2026-09-26T01:00:00.000Z" })) }));
  await page.goto("/hub/campaigns");
  await page.getByRole("list", { name: "Daftar kampanye" }).getByRole("button", { name: "Kelas menulis kreatif" }).click();
  const detail = page.getByRole("dialog", { name: "Kelas menulis kreatif" });
  await detail.getByRole("button", { name: "Ajukan tinjauan" }).click();
  await expect(detail.locator(".error-message")).toContainText("Status kampanye sudah berubah; kami memuat versi terbaru");
  await expect(detail.locator(".detail-status .status")).toHaveText("Menunggu tinjauan");
  await expect(detail.getByRole("button", { name: "Tarik pengajuan" })).toBeVisible();
});

test("API: dialog detail yang tertutup native saat aksi berjalan dibuka lagi sampai aksi selesai", async ({ page }) => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await mockCampaignList(page);
  await page.route("**/api/web/sponsor/ads/ad_1/submit", async route => { await gate; await route.fulfill({ json: envelope(apiAd({ status: "PENDING_REVIEW", displayStatus: "PENDING_REVIEW" })) }); });
  await page.goto("/hub/campaigns");
  await page.getByRole("list", { name: "Daftar kampanye" }).getByRole("button", { name: "Kelas menulis kreatif" }).click();
  const detail = page.getByRole("dialog", { name: "Kelas menulis kreatif" });
  await detail.getByRole("button", { name: "Ajukan tinjauan" }).click();
  await expect(detail.getByRole("button", { name: "Memproses…" })).toBeVisible();
  await detail.evaluate(el => (el as HTMLDialogElement).close());
  await expect(detail).toBeVisible();
  release();
  await expect(detail.locator(".detail-status .status")).toHaveText("Menunggu tinjauan");
  await detail.getByRole("button", { name: "Tutup detail" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("API: banner yang selesai diunggah setelah editor ditutup diabaikan dan object URL-nya dilepas", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { created: string[]; revoked: string[] };
    w.created = []; w.revoked = [];
    const create = URL.createObjectURL.bind(URL); const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource) => { const url = create(obj); if (obj instanceof File) w.created.push(url); return url; };
    URL.revokeObjectURL = (url: string) => { w.revoked.push(url); revoke(url); };
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await mockSponsorApi(page, () => undefined);
  await page.route("**/api/web/sponsor/banners", async route => {
    await gate;
    await route.fulfill({ status: 201, json: envelope({ fileId: "file_late", mimeType: "image/webp", width: 1200, height: 600, sizeBytes: 1000 }) });
  });
  await page.goto("/hub/campaigns");
  await page.getByRole("button", { name: "Buat kampanye pertama" }).click();
  const editor = page.getByRole("dialog", { name: "Buat kampanye" });
  await editor.locator("#campaign-banner").setInputFiles({ name: "banner.png", mimeType: "image/png", buffer: await pngOf(page, 1200, 600) });
  await expect(editor.getByText("Mengunggah banner…")).toBeVisible();
  await editor.getByRole("button", { name: "Tutup editor" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  release();
  await expect.poll(() => page.evaluate(() => { const w = window as unknown as { created: string[]; revoked: string[] }; return w.created.length > 0 && w.created.every(u => w.revoked.includes(u)); })).toBe(true);
  await page.getByRole("button", { name: "Buat kampanye pertama" }).click();
  await expect(page.getByRole("dialog", { name: "Buat kampanye" }).locator(".banner-frame")).not.toHaveClass(/has-banner/);
});

test("API: mutasi saldo 'Muat lebih banyak' tidak menggandakan baris saat halaman bergeser", async ({ page }) => {
  const consoleErrors: string[] = []; page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
  const entry = (n: number) => ({ id: `led-${n}`, seq: 1000 - n, type: "CLICK_CHARGE", amount: -500, balanceAfter: 100_000 + n * 500, note: null, topUpRequestId: null, adId: null, createdAt: new Date(Date.now() - n * 60_000).toISOString() });
  await mockSponsorApi(page, () => undefined);
  await page.route("**/api/web/sponsor/ledger**", route => {
    const pageNo = Number(new URL(route.request().url()).searchParams.get("page"));
    const rows = pageNo === 1 ? Array.from({ length: 20 }, (_, i) => entry(i + 1)) : [entry(20), entry(21)];
    return route.fulfill({ json: envelope(rows, { page: pageNo, total: 22, totalPages: 2 }) });
  });
  await page.goto("/hub/balance");
  await expect(page.locator(".ledger-row")).toHaveCount(20);
  await page.getByRole("button", { name: "Muat lebih banyak" }).click();
  await expect(page.locator(".ledger-row")).toHaveCount(21);
  expect(consoleErrors.filter(t => /same key/i.test(t))).toEqual([]);
});

test("API: sponsor ditangguhkan tidak melihat tombol Batalkan pada top-up menunggu", async ({ page }) => {
  const pendingTopUp = { id: "tu_1", sponsorId: "sp1", amount: 500_000, transferDate: wibToday(), senderName: "PT Cahaya Ilmu", senderBank: "BCA", note: null, status: "PENDING", reviewNote: null, reviewedAt: null, proofFileId: "file_proof", createdAt: new Date().toISOString() };
  await mockSponsorApi(page, path => {
    if (path === "/sponsor/profile") return { ...profile, status: "SUSPENDED", statusReason: "Verifikasi ulang dokumen." };
    if (path === "/sponsor/topups") return [pendingTopUp];
    return undefined;
  });
  await page.goto("/hub/balance");
  await expect(page.locator(".topup-row").first()).toContainText("Menunggu");
  await expect(page.locator(".topup-row").getByRole("button", { name: "Batalkan" })).toHaveCount(0);
});
