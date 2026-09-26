import { expect, test, type Page } from "@playwright/test";

/** Super admin (mode demo): moderasi iklan & verifikasi top-up. Tidak ada permintaan API di mode demo. */

async function demoSuperAdmin(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem("studenthub_demo", "true");
    sessionStorage.setItem("studenthub_demo_role", "SUPER_ADMIN");
  });
}
const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("moderasi iklan: antrean 2 iklan, detail dengan banner & pratinjau, tolak beralasan -> keluar dari antrean", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await demoSuperAdmin(page);
  await page.goto("/hub/ad-review");
  await expect(page.getByRole("heading", { level: 1, name: "Moderasi iklan" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Menunggu tinjauan (2)" })).toHaveAttribute("aria-checked", "true");
  const queue = page.getByRole("list", { name: "Antrean iklan" });
  await expect(queue.getByRole("listitem")).toHaveCount(2);
  // Terlama diajukan dulu: beasiswa (kemarin) sebelum buku (hari ini). Layar lebar memilih item pertama.
  await expect(queue.getByRole("button").first()).toContainText("Beasiswa Cahaya Prestasi 2027");
  const detail = page.getByRole("region", { name: "Detail iklan" });
  await expect(detail.getByRole("heading", { name: "Beasiswa Cahaya Prestasi 2027" })).toBeVisible();
  await expect(detail.getByRole("img", { name: "Banner iklan: Beasiswa Cahaya Prestasi 2027" })).toBeVisible();
  await expect(detail.getByText("Tampil di beranda siswa")).toBeVisible();
  await expect(detail.getByText("cahayailmu.example", { exact: true })).toBeVisible();
  await expect(detail.getByRole("link", { name: /Buka tautan/ })).toHaveAttribute("rel", "noopener noreferrer");

  await detail.getByRole("button", { name: "Tolak", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tolak iklan" });
  await dialog.getByRole("button", { name: "Tolak iklan" }).click();
  await expect(dialog.getByText("Tulis alasan agar sponsor tahu")).toBeVisible();
  await dialog.getByRole("button", { name: "Klaim tidak dapat diverifikasi" }).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("Klaim tidak dapat diverifikasi");
  await dialog.getByRole("button", { name: "Tolak iklan" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/Mode demo: iklan ditolak/)).toBeVisible();
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "Menunggu tinjauan (1)" })).toBeVisible();
  await expect(detail.getByRole("heading", { name: "Buku catatan dari kertas daur ulang" })).toBeVisible();

  // Tab Ditolak: contoh yang sudah ditolak di data demo + iklan yang baru saja ditolak.
  await page.getByRole("radio", { name: "Ditolak" }).click();
  const rejected = page.getByRole("list", { name: "Antrean iklan" });
  await expect(rejected.getByRole("listitem")).toHaveCount(2);
  await rejected.getByRole("listitem").filter({ hasText: "Beasiswa Cahaya Prestasi 2027" }).getByRole("button").first().click();
  await expect(detail.getByText("Klaim tidak dapat diverifikasi", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("moderasi iklan: setujui memakai konfirmasi ringan; iklan tayang bisa diturunkan", async ({ page }) => {
  await demoSuperAdmin(page);
  await page.goto("/hub/ad-review");
  const detail = page.getByRole("region", { name: "Detail iklan" });
  await detail.getByRole("button", { name: "Setujui" }).click();
  const confirm = page.getByRole("dialog", { name: "Setujui iklan ini?" });
  await expect(confirm).toContainText("semua sekolah");
  await confirm.getByRole("button", { name: "Ya, setujui" }).click();
  await expect(page.getByText(/Mode demo: iklan disetujui/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Antrean iklan" }).getByRole("listitem")).toHaveCount(1);

  await page.getByRole("radio", { name: "Disetujui" }).click();
  await expect(page.getByRole("list", { name: "Antrean iklan" }).getByRole("listitem")).toHaveCount(5);
  // Mode demo: pencarian judul menyaring data contoh secara lokal.
  const search = page.getByRole("searchbox", { name: "Cari judul iklan" });
  await search.fill("belajar");
  await expect(page.getByRole("list", { name: "Antrean iklan" }).getByRole("listitem")).toHaveCount(2);
  await search.fill("");
  await expect(page.getByRole("list", { name: "Antrean iklan" }).getByRole("listitem")).toHaveCount(5);
  await detail.getByRole("button", { name: "Turunkan iklan" }).click();
  const takedown = page.getByRole("dialog", { name: "Turunkan iklan" });
  await takedown.getByRole("textbox").fill("Tautan tujuan meminta nomor HP siswa.");
  await takedown.getByRole("button", { name: "Turunkan iklan" }).click();
  await expect(page.getByRole("list", { name: "Antrean iklan" }).getByRole("listitem")).toHaveCount(4);
});

test("verifikasi top-up: bukti transfer besar, setujui wajib centang nominal sesuai", async ({ page }) => {
  await demoSuperAdmin(page);
  await page.goto("/hub/topups");
  await expect(page.getByRole("heading", { level: 1, name: "Verifikasi top-up" })).toBeVisible();
  const queue = page.getByRole("list", { name: "Antrean top-up" });
  await expect(queue.getByRole("listitem")).toHaveCount(2);
  const detail = page.getByRole("region", { name: "Detail top-up" });
  const proof = detail.getByRole("link", { name: /Bukti transfer Rp/ });
  await expect(proof).toHaveAttribute("target", "_blank");
  await expect(proof.getByRole("img")).toBeVisible();
  await expect(detail.getByText("Setelah disetujui")).toBeVisible();

  const approve = detail.getByRole("button", { name: "Setujui" });
  await expect(approve).toBeDisabled();
  await detail.getByRole("checkbox", { name: /Nominal pada bukti sesuai Rp/ }).check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText(/Mode demo: top-up disetujui/)).toBeVisible();
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("radio", { name: "Menunggu (1)" })).toBeVisible();

  await detail.getByRole("button", { name: "Tolak" }).click();
  const dialog = page.getByRole("dialog", { name: "Tolak top-up" });
  await dialog.getByRole("button", { name: "Bukti tidak terbaca" }).click();
  await dialog.getByRole("button", { name: "Tolak top-up" }).click();
  await expect(page.getByText("Semua top-up sudah diverifikasi")).toBeVisible();
});

// ----------------------------------------------------------------------------- mode akun (API di-mock)

const identity = { user: { id: "sa1", name: "Dimas Wicaksono", email: "dimas@example.test", role: "SUPER_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false }, school: null, sponsor: null, permissions: [] };
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });
const failure = (code: string, message: string) => ({ success: false, data: null, error: { code, message }, meta: null });

interface Posted { readonly path: string; readonly body: string | null }

/** Semua /api/web/** di-mock; `handle` menjawab jalur milik test, sisanya daftar kosong. */
async function mockApi(page: Page, handle: (method: string, path: string, body: string | null) => { status?: number; json: unknown } | null): Promise<Posted[]> {
  const posted: Posted[] = [];
  await page.route("**/api/web/**", route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/web", "") + url.search;
    if (request.method() === "POST") posted.push({ path: url.pathname.replace("/api/web", ""), body: request.postData() });
    if (path === "/auth/me") return route.fulfill({ json: envelope(identity) });
    if (path.startsWith("/notifications/unread-count")) return route.fulfill({ json: envelope({ total: 0 }) });
    const answer = handle(request.method(), path, request.postData());
    if (answer) return route.fulfill({ status: answer.status ?? 200, json: answer.json });
    return route.fulfill({ json: envelope([], { page: 1, total: 0, totalPages: 1 }) });
  });
  return posted;
}

const reviewAd = (submittedAt: string) => ({
  id: "ad1", sponsorId: "sp1", title: "Kelas robotik akhir pekan", imageFileId: "file-banner-1", imageUrl: null, linkType: "EXTERNAL_URL", targetUrl: "https://robotik.example/kelas",
  startAt: "2026-10-01T17:00:00.000Z", endAt: "2099-11-01T17:00:00.000Z", status: "PENDING_REVIEW", displayStatus: "PENDING_REVIEW", isActive: false, targetScope: "ALL", targets: [],
  cpcAmount: 500, submittedAt, reviewNote: null, reviewedAt: null, createdAt: "2026-09-20T02:00:00.000Z", updatedAt: submittedAt,
  sponsor: { id: "sp1", companyName: "Robotik Ceria", status: "APPROVED", balance: 250_000 }, urlHost: "robotik.example", isPunycodeHost: true,
});

test("akun asli: setujui iklan mengirim submittedAt persis dari detail; AD_REVIEW_STALE memuat ulang detail", async ({ page }) => {
  const first = "2026-09-25T02:30:00.000Z";
  const second = "2026-09-26T01:00:00.000Z";
  let detailCalls = 0;
  let approveCalls = 0;
  const posted = await mockApi(page, (method, path) => {
    if (method === "GET" && path.startsWith("/platform/ads?status=PENDING_REVIEW")) return { json: envelope(approveCalls > 1 ? [] : [reviewAd(first)], { page: 1, total: approveCalls > 1 ? 0 : 1, totalPages: 1 }) };
    if (method === "GET" && path === "/platform/ads/ad1") { detailCalls += 1; return { json: envelope(reviewAd(detailCalls > 1 ? second : first)) }; }
    if (method === "POST" && path === "/platform/ads/ad1/approve") {
      approveCalls += 1;
      return approveCalls === 1 ? { status: 409, json: failure("AD_REVIEW_STALE", "Iklan telah diajukan ulang sejak Anda membukanya.") } : { json: envelope({ ...reviewAd(second), status: "APPROVED" }) };
    }
    return null;
  });
  await page.goto("/hub/ad-review");
  const detail = page.getByRole("region", { name: "Detail iklan" });
  await expect(detail.getByRole("heading", { name: "Kelas robotik akhir pekan" })).toBeVisible();
  await expect(detail.getByRole("img", { name: /Banner iklan/ })).toHaveAttribute("src", "/api/web/files/file-banner-1");
  await expect(detail.getByRole("note").filter({ hasText: "xn--" })).toBeVisible();

  await detail.getByRole("button", { name: "Setujui" }).click();
  await page.getByRole("dialog", { name: "Setujui iklan ini?" }).getByRole("button", { name: "Ya, setujui" }).click();
  await expect(detail.getByRole("status").filter({ hasText: "diajukan ulang" })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(posted[0]).toEqual({ path: "/platform/ads/ad1/approve", body: JSON.stringify({ submittedAt: first }) });

  await expect.poll(() => detailCalls).toBeGreaterThan(1);
  await detail.getByRole("button", { name: "Setujui" }).click();
  await page.getByRole("dialog", { name: "Setujui iklan ini?" }).getByRole("button", { name: "Ya, setujui" }).click();
  await expect(page.getByText("Iklan disetujui dan tayang untuk siswa sesuai jadwal.")).toBeVisible();
  expect(posted[1]).toEqual({ path: "/platform/ads/ad1/approve", body: JSON.stringify({ submittedAt: second }) });
  await expect(page.getByText("Antrean bersih")).toBeVisible();
});

test("akun asli: setujui top-up tanpa body, saldo baru dari ledger; tolak mengirim alasan", async ({ page }) => {
  const topUp = (id: string, amount: number) => ({
    id, sponsorId: "sp1", amount, transferDate: "2026-09-25", senderName: "Robotik Ceria", senderBank: "BCA", note: "Top-up bulan Oktober", status: "PENDING", reviewNote: null, reviewedAt: null,
    proofFileId: `file-proof-${id}`, createdAt: "2026-09-25T03:00:00.000Z", sponsor: { id: "sp1", companyName: "Robotik Ceria", status: "APPROVED", balance: 250_000 }, duplicateProofOf: id === "tu2" ? ["cm1x9zq0000ab12cd"] : [],
  });
  const posted = await mockApi(page, (method, path) => {
    if (method === "GET" && path.startsWith("/platform/topups?status=PENDING")) return { json: envelope([topUp("tu1", 1_000_000), topUp("tu2", 300_000)], { page: 1, total: 2, totalPages: 1 }) };
    if (method === "POST" && path === "/platform/topups/tu1/approve") return { json: envelope({ topUp: { ...topUp("tu1", 1_000_000), status: "APPROVED" }, ledgerEntry: { id: "l1", seq: 1, type: "TOPUP", amount: 1_000_000, balanceAfter: 1_250_000, note: null, topUpRequestId: "tu1", adId: null, createdAt: "2026-09-26T03:00:00.000Z" } }) };
    if (method === "POST" && path === "/platform/topups/tu2/reject") return { json: envelope({ ...topUp("tu2", 300_000), status: "REJECTED" }) };
    return null;
  });
  await page.goto("/hub/topups");
  const detail = page.getByRole("region", { name: "Detail top-up" });
  await expect(detail.getByRole("link", { name: /Bukti transfer/ })).toHaveAttribute("href", "/api/web/files/file-proof-tu1");
  await detail.getByRole("checkbox", { name: /Nominal pada bukti sesuai/ }).check();
  await detail.getByRole("button", { name: "Setujui" }).click();
  await expect(page.getByText(/Top-up disetujui\. Saldo Robotik Ceria kini Rp\s1\.250\.000/)).toBeVisible();
  expect(posted[0]).toEqual({ path: "/platform/topups/tu1/approve", body: null });

  await expect(detail.getByRole("note").filter({ hasText: "#AB12CD" })).toBeVisible();
  await detail.getByRole("button", { name: "Tolak", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tolak top-up" });
  await dialog.getByRole("button", { name: "Nominal tidak sesuai" }).click();
  await dialog.getByRole("button", { name: "Tolak top-up" }).click();
  await expect(page.getByText("Top-up ditolak. Sponsor menerima alasanmu lewat notifikasi.")).toBeVisible();
  expect(posted[1]).toEqual({ path: "/platform/topups/tu2/reject", body: JSON.stringify({ reason: "Nominal tidak sesuai" }) });
});

test("HP 390px: antrean -> sheet detail tanpa luapan horizontal (iklan & top-up)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demoSuperAdmin(page);
  await page.goto("/hub/ad-review");
  const queue = page.getByRole("list", { name: "Antrean iklan" });
  await expect(queue.getByRole("listitem")).toHaveCount(2);
  expect(await noOverflow(page)).toBe(true);
  await queue.getByRole("button").first().click();
  const sheet = page.getByRole("dialog", { name: "Detail iklan" });
  await expect(sheet.getByRole("img", { name: /Banner iklan/ })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Setujui" })).toBeVisible();
  expect(await sheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await noOverflow(page)).toBe(true);
  await sheet.getByRole("button", { name: "Tutup detail" }).click();
  await expect(sheet).toHaveCount(0);
  // Keputusan dari dalam sheet: dialog konfirmasi di atas sheet, lalu keduanya tertutup dan antrean berkurang.
  await queue.getByRole("button").first().click();
  await sheet.getByRole("button", { name: "Setujui" }).click();
  await page.getByRole("dialog", { name: "Setujui iklan ini?" }).getByRole("button", { name: "Ya, setujui" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await queue.getByRole("button").first().click();
  await expect(sheet.getByRole("heading", { name: "Buku catatan dari kertas daur ulang" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);

  await page.goto("/hub/topups");
  const topups = page.getByRole("list", { name: "Antrean top-up" });
  await topups.getByRole("button").first().click();
  const topupSheet = page.getByRole("dialog", { name: "Detail top-up" });
  await expect(topupSheet.getByRole("checkbox", { name: /Nominal pada bukti sesuai/ })).toBeVisible();
  expect(await topupSheet.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await noOverflow(page)).toBe(true);
});

// ----------------------------------------------------------------------------- paginasi, pencarian, galat & fokus

const adRow = (id: string, title: string, status = "PENDING_REVIEW") => ({ ...reviewAd("2026-09-25T02:30:00.000Z"), id, title, status, displayStatus: status });
const deferred = () => {
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { gate, release: () => release() };
};

test("akun asli: antrean > 50 memakai 'Muat lebih banyak' tanpa duplikat; tab Disetujui dicari per judul (debounce)", async ({ page }) => {
  const pending = Array.from({ length: 60 }, (_, i) => adRow(`p${i + 1}`, `Iklan antrean ${i + 1}`));
  const approved = [adRow("a1", "Kelas robotik akhir pekan", "APPROVED"), adRow("a2", "Beasiswa prestasi", "APPROVED"), adRow("a3", "Robot pintar SD", "APPROVED")];
  const lists: string[] = [];
  await mockApi(page, (method, path) => {
    const url = new URL(path, "http://mock");
    if (method !== "GET") return null;
    const detail = /^\/platform\/ads\/([^/]+)$/.exec(url.pathname);
    if (detail) return { json: envelope([...pending, ...approved].find(a => a.id === detail[1])) };
    if (url.pathname !== "/platform/ads") return null;
    if (url.searchParams.get("limit") !== "1") lists.push(url.search);
    const pageNo = Number(url.searchParams.get("page") ?? "1");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    // Halaman 2 sengaja mengulang satu baris halaman 1 (data bergeser) -> tidak boleh tampil ganda.
    if (url.searchParams.get("status") === "PENDING_REVIEW") return { json: envelope(pageNo === 1 ? pending.slice(0, 50) : pending.slice(49), { page: pageNo, total: 60, totalPages: 2 }) };
    const rows = approved.filter(a => a.title.toLowerCase().includes(q));
    return { json: envelope(rows, { page: 1, total: rows.length, totalPages: 1 }) };
  });
  await page.goto("/hub/ad-review");
  const queue = page.getByRole("list", { name: "Antrean iklan" });
  await expect(queue.getByRole("listitem")).toHaveCount(50);
  await expect(page.getByText("Menampilkan 50 dari 60")).toBeVisible();
  await page.getByRole("button", { name: "Muat lebih banyak" }).click();
  await expect(queue.getByRole("listitem")).toHaveCount(60);
  await expect(page.getByText("Menampilkan 50 dari 60")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Muat lebih banyak" })).toHaveCount(0);
  await expect(queue.getByRole("button").nth(50)).toBeFocused();
  expect(lists).toContain("?status=PENDING_REVIEW&page=2&limit=50");

  await expect(page.getByRole("searchbox")).toHaveCount(0);
  await page.getByRole("radio", { name: "Disetujui" }).click();
  await expect(queue.getByRole("listitem")).toHaveCount(3);
  const search = page.getByRole("searchbox", { name: "Cari judul iklan" });
  await search.pressSequentially("robot", { delay: 40 });
  await expect(queue.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByText("2 iklan disetujui dengan judul memuat “robot”")).toBeVisible();
  expect(lists.filter(s => s.includes("q="))).toEqual(["?status=APPROVED&page=1&limit=50&q=robot"]);
  await search.fill("zzz");
  await expect(page.getByText("Tidak ada yang cocok")).toBeVisible();
  await expect(search).toBeFocused();
});

test("akun asli: ringkasan nominal top-up diberi label bila belum semua baris termuat", async ({ page }) => {
  const topUp = (id: string, amount: number) => ({
    id, sponsorId: "sp1", amount, transferDate: "2026-09-25", senderName: "Robotik Ceria", senderBank: "BCA", note: null, status: "PENDING", reviewNote: null, reviewedAt: null,
    proofFileId: `file-proof-${id}`, createdAt: "2026-09-25T03:00:00.000Z", sponsor: { id: "sp1", companyName: "Robotik Ceria", status: "APPROVED", balance: 0 }, duplicateProofOf: [],
  });
  await mockApi(page, (method, path) => (method === "GET" && path.startsWith("/platform/topups?status=PENDING")
    ? { json: envelope([topUp("tu1", 1_000_000), topUp("tu2", 300_000)], { page: 1, total: 60, totalPages: 2 }) } : null));
  await page.goto("/hub/topups");
  await expect(page.getByText(/60 pengajuan menunggu · Rp\s1\.300\.000 \(dari 2 yang ditampilkan\)/)).toBeVisible();
  await expect(page.getByText("Menampilkan 2 dari 60")).toBeVisible();
});

test("akun asli: AD_INVALID_TRANSITION dijelaskan lewat toast lalu antrean dimuat ulang", async ({ page }) => {
  const first = "2026-09-25T02:30:00.000Z";
  let rejected = false;
  await mockApi(page, (method, path) => {
    if (method === "GET" && path.startsWith("/platform/ads?status=PENDING_REVIEW")) return { json: envelope(rejected ? [] : [reviewAd(first)], { page: 1, total: rejected ? 0 : 1, totalPages: 1 }) };
    if (method === "GET" && path === "/platform/ads/ad1") return { json: envelope(reviewAd(first)) };
    if (method === "POST" && path === "/platform/ads/ad1/reject") { rejected = true; return { status: 409, json: failure("AD_INVALID_TRANSITION", "Aksi ini tidak berlaku untuk status iklan saat ini.") }; }
    return null;
  });
  await page.goto("/hub/ad-review");
  const detail = page.getByRole("region", { name: "Detail iklan" });
  await detail.getByRole("button", { name: "Tolak", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tolak iklan" });
  await dialog.getByRole("button", { name: "Klaim tidak dapat diverifikasi" }).click();
  await dialog.getByRole("button", { name: "Tolak iklan" }).click();
  await expect(page.getByText(/Iklan ini sudah tidak menunggu tinjauan — mungkin ditarik sponsor atau sudah diputus admin lain/)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Antrean bersih")).toBeVisible();
});

test("akun asli: galat memuat detail tampil dengan Coba lagi; tombol menunggu 'Memuat data terbaru…'", async ({ page }) => {
  const first = "2026-09-25T02:30:00.000Z";
  await mockApi(page, (method, path) => (method === "GET" && path.startsWith("/platform/ads?status=PENDING_REVIEW") ? { json: envelope([reviewAd(first)], { page: 1, total: 1, totalPages: 1 }) } : null));
  let failing = true;
  const slow = deferred();
  await page.route("**/api/web/platform/ads/ad1", async route => {
    if (failing) return route.fulfill({ status: 500, json: failure("INTERNAL", "Server sedang sibuk.") });
    await slow.gate;
    return route.fulfill({ json: envelope(reviewAd(first)) });
  });
  await page.goto("/hub/ad-review");
  const detail = page.getByRole("region", { name: "Detail iklan" });
  const alert = detail.getByRole("alert").filter({ hasText: "Data terbaru iklan belum dapat dimuat" });
  await expect(alert).toContainText("Server sedang sibuk.");
  await expect(detail.getByRole("button", { name: "Setujui" })).toBeDisabled();
  failing = false;
  await alert.getByRole("button", { name: "Coba lagi" }).click();
  await expect(detail.getByRole("status").filter({ hasText: "Memuat data terbaru…" })).toBeVisible();
  await expect(detail.getByRole("button", { name: "Setujui" })).toBeDisabled();
  slow.release();
  await expect(detail.getByRole("button", { name: "Setujui" })).toBeEnabled();
  await expect(detail.getByText("Memuat data terbaru…")).toHaveCount(0);
});

test("akun asli: pemberitahuan AD_REVIEW_STALE hilang saat pindah item; Escape berulang saat memproses tidak menutup dialog", async ({ page }) => {
  const ads = [adRow("ad1", "Kelas robotik akhir pekan"), adRow("ad2", "Les bahasa Inggris")];
  const slow = deferred();
  await mockApi(page, (method, path) => {
    if (method === "GET" && path.startsWith("/platform/ads?status=PENDING_REVIEW")) return { json: envelope(ads, { page: 1, total: 2, totalPages: 1 }) };
    const detail = /^\/platform\/ads\/(ad\d)$/.exec(path);
    if (method === "GET" && detail) return { json: envelope(ads.find(a => a.id === detail[1])) };
    if (method === "POST" && path === "/platform/ads/ad1/approve") return { status: 409, json: failure("AD_REVIEW_STALE", "Iklan telah diajukan ulang sejak Anda membukanya.") };
    return null;
  });
  await page.route("**/api/web/platform/ads/ad1/reject", async route => { await slow.gate; return route.fulfill({ json: envelope({ ...ads[0], status: "REJECTED" }) }); });
  await page.goto("/hub/ad-review");
  const detail = page.getByRole("region", { name: "Detail iklan" });
  const queue = page.getByRole("list", { name: "Antrean iklan" });
  await detail.getByRole("button", { name: "Setujui" }).click();
  await page.getByRole("dialog", { name: "Setujui iklan ini?" }).getByRole("button", { name: "Ya, setujui" }).click();
  const notice = detail.getByRole("status").filter({ hasText: "diajukan ulang" });
  await expect(notice).toBeVisible();
  await queue.getByRole("button", { name: /Les bahasa Inggris/ }).click();
  await queue.getByRole("button", { name: /Kelas robotik/ }).click();
  await expect(detail.getByRole("heading", { name: "Kelas robotik akhir pekan" })).toBeVisible();
  await expect(notice).toHaveCount(0);

  await detail.getByRole("button", { name: "Tolak", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tolak iklan" });
  await dialog.getByRole("button", { name: "Kualitas banner kurang jelas" }).click();
  await dialog.getByRole("button", { name: "Tolak iklan" }).click();
  await expect(dialog.getByRole("button", { name: "Memproses…" })).toBeDisabled();
  for (let i = 0; i < 3; i += 1) await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  slow.release();
  await expect(page.getByText("Iklan ditolak. Sponsor menerima alasanmu lewat notifikasi.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("HP 390px: fokus kembali ke pembuka setelah sheet/dialog ditutup; seleksi teks diseret ke latar tidak menutup sheet", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await demoSuperAdmin(page);
  await page.goto("/hub/ad-review");
  const queue = page.getByRole("list", { name: "Antrean iklan" });
  const firstItem = queue.getByRole("button").first();
  const sheet = page.getByRole("dialog", { name: "Detail iklan" });
  await firstItem.click();
  const box = await sheet.getByRole("heading", { level: 2 }).boundingBox();
  if (!box) throw new Error("judul sheet tidak terlihat");
  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(195, 10, { steps: 6 });
  await page.mouse.up();
  await expect(sheet).toBeVisible();
  await page.mouse.click(195, 10);
  await expect(sheet).toHaveCount(0);
  await expect(firstItem).toBeFocused();

  await firstItem.click();
  await sheet.getByRole("button", { name: "Tutup detail" }).click();
  await expect(firstItem).toBeFocused();

  await firstItem.click();
  await sheet.getByRole("button", { name: "Tolak", exact: true }).click();
  await page.getByRole("dialog", { name: "Tolak iklan" }).getByRole("button", { name: "Batal" }).click();
  await expect(sheet.getByRole("button", { name: "Tolak", exact: true })).toBeFocused();
  await sheet.getByRole("button", { name: "Setujui" }).click();
  await page.getByRole("dialog", { name: "Setujui iklan ini?" }).getByRole("button", { name: "Ya, setujui" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(queue.getByRole("listitem")).toHaveCount(1);
  await expect(queue.getByRole("button").first()).toBeFocused();
});
