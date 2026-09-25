import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoStudents, demoSummary } from "../../src/lib/frontend/demo";
import { verifyPageSlides } from "./page-slide-scenario";
import { verifyScrollMemory } from "./scroll-memory-scenario";

const identity = { user: { id: "user1", name: "Admin Sekolah", email: "admin@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false }, school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))] };
const envelope = (data: unknown, meta: unknown = null) => ({ success: true, data, error: null, meta });
async function mockSession(page: Page) {
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    const data = path === "/auth/me" ? identity : path === "/school/dashboard/summary" ? demoSummary : path === "/notifications/unread-count" ? { total: 3 } : path === "/school/students" ? demoStudents : [];
    return route.fulfill({ json: envelope(data, { page: 1, total: Array.isArray(data) ? data.length : 0, totalPages: 1 }) });
  });
}
test("demo: navigasi, pencarian, detail, formulir, dan penolakan simpan", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await expect(page.getByRole("heading", { name: /Selamat datang/ })).toBeVisible();
  await page.getByRole("navigation").getByRole("link", { name: "Data siswa" }).click();
  await expect(page.getByText("Alya Putri Ramadhani", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Cari data" }).fill("Alya");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByRole("button", { name: "Lihat detail Alya Putri Ramadhani" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Edit data", exact: true }).click();
  await expect(page.getByLabel("Nama", { exact: true })).toHaveValue("Alya Putri Ramadhani");
  await page.getByRole("button", { name: "Simpan & lanjutkan" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Mode demo digunakan" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});
test("mobile: login, dasbor, menu, dan formulir tanpa luapan horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await expect(page.getByRole("heading", { name: /Selamat datang/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Buka navigasi" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Data siswa" }).click();
  await page.getByRole("button", { name: "Tambah siswa" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.getByRole("dialog").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: "test-results/frontend-mobile-form.png", fullPage: true });
});
test("peran demo dipertahankan ketika pindah halaman", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  for (const [role, menu, heading] of [["SPONSOR", "Kampanye saya", "Kampanye saya"], ["STUDENT", "Rapor saya", "Rapor saya"], ["SUPER_ADMIN", "Sekolah", "Sekolah"]]) {
    await page.getByRole("combobox", { name: "Peran demo" }).selectOption(role!);
    await page.getByRole("navigation").getByRole("link", { name: menu!, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(heading!);
    await expect(page.getByRole("combobox", { name: "Peran demo" })).toHaveValue(role!);
  }
});
test("formulir siswa mengirim body sesuai kontrak dan menampilkan kredensial persis", async ({ page }) => {
  await mockSession(page);
  let body: Record<string, unknown> | undefined;
  await page.route("**/api/web/school/students", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: envelope({ student: body, temporaryPassword: "TempSiswa123", tempPasswordExpiresAt: "2026-10-06T00:00:00Z" }) });
  });
  await page.goto("/hub/students");
  await page.getByRole("button", { name: "Tambah siswa" }).click();
  await page.getByLabel("NISN", { exact: false }).first().fill("0012345678");
  await page.getByLabel(/^NIS \*/).fill("S-001");
  await page.getByLabel(/^Nama \*/).fill("Siswa Pengujian");
  await page.getByLabel(/^Jenis kelamin/).selectOption("FEMALE");
  await page.getByRole("checkbox", { name: /Langsung aktifkan siswa/ }).uncheck();
  await page.getByRole("button", { name: "Simpan & lanjutkan" }).click();
  await expect(page.getByText("TempSiswa123", { exact: true })).toBeVisible();
  expect(body).toMatchObject({ nisn: "0012345678", nis: "S-001", name: "Siswa Pengujian", gender: "FEMALE", activate: false });
  expect(body).not.toHaveProperty("schoolId");
});
test("lembar nilai menyimpan perubahan melalui kontrak entries", async ({ page }) => {
  await mockSession(page);
  const sheet = { term: { id: "term1", label: "Ganjil" }, class: { id: "class1", name: "X A" }, subject: { id: "subject1", name: "Matematika", code: "MTK", kkm: 75 }, rows: [{ studentId: "student1", name: "Siswa Pertama", nis: "001", studentStatus: "ACTIVE", reportCardId: "report1", reportCardStatus: "DRAFT", score: 80, predicate: "B", description: null, blockedReason: null }] };
  await page.route("**/api/web/school/report-cards/sheet?**", r => r.fulfill({ json: envelope(sheet) }));
  await page.route("**/api/web/school/academic-years", r => r.fulfill({ json: envelope([{ id: "year1", name: "2026/2027", terms: [{ id: "term1", label: "Ganjil" }] }]) }));
  await page.route("**/api/web/school/classes", r => r.fulfill({ json: envelope([{ id: "class1", name: "X A" }]) }));
  await page.route("**/api/web/school/subjects", r => r.fulfill({ json: envelope([{ id: "subject1", name: "Matematika" }]) }));
  let payload: unknown;
  await page.route("**/api/web/school/report-cards/grades", r => { payload = r.request().postDataJSON(); return r.fulfill({ json: envelope({ updated: 1 }) }); });
  await page.goto("/hub/reports");
  await page.getByLabel("Pilih tampilan").selectOption("getReportCardGradeSheet");
  await page.getByLabel(/^Semester/).selectOption("term1");
  await page.getByLabel(/^Kelas/).selectOption("class1");
  await page.getByLabel(/^Mata pelajaran/).selectOption("subject1");
  await page.getByLabel("Nilai Siswa Pertama").fill("90");
  await page.getByRole("button", { name: "Simpan nilai" }).click();
  await expect(page.getByRole("status")).toContainText("Nilai siswa berhasil disimpan.");
  expect(payload).toEqual({ termId: "term1", classId: "class1", subjectId: "subject1", entries: [{ studentId: "student1", score: 90 }] });
});
test("kegagalan API menampilkan retry dan tidak menggantinya dengan data contoh", async ({ page }) => {
  await mockSession(page);
  let fail = true;
  await page.route("**/api/web/school/students?**", route => fail ? route.fulfill({ status: 503, json: { success: false, error: { code: "UNAVAILABLE", message: "Koneksi terputus." } } }) : route.fulfill({ json: envelope(demoStudents) }));
  await page.goto("/hub/students");
  await expect(page.getByText("Koneksi terputus.")).toBeVisible();
  await expect(page.locator("tbody tr")).toHaveCount(0);
  fail = false;
  await page.getByRole("button", { name: "Coba lagi" }).click();
  await expect(page.locator("tbody tr")).toHaveCount(6);
});
test("gerbang kata sandi wajib membatasi ruang kerja ke keamanan", async ({ page }) => {
  await mockSession(page);
  await page.route("**/api/web/auth/me", route => route.fulfill({ json: envelope({ ...identity, user: { ...identity.user, mustChangePassword: true } }) }));
  await page.goto("/hub/students");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Keamanan akun");
  await expect(page.getByText("Sebelum melanjutkan, ganti kata sandi awal", { exact: false })).toBeVisible();
});
test("siswa (HP): beranda ringkas, alur absen wajib izin lokasi & kamera sebelum lanjut", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36" });
  const page = await context.newPage();
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption("STUDENT");
  await page.goto("/hub");
  await expect(page.getByRole("navigation", { name: "Menu siswa" }).getByRole("link")).toHaveCount(6);
  await expect(page.getByText("Kamu belum absen")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("navigation", { name: "Menu siswa" }).getByRole("link", { name: "Absen" }).click();
  const flow = page.getByRole("dialog", { name: "Izinkan perangkat" });
  await expect(flow).toBeVisible();
  await expect(flow.getByRole("button", { name: "Izinkan lokasi & kamera" })).toBeVisible();
  await expect(flow.getByRole("button", { name: "Lanjut ke foto wajah" })).toHaveCount(0);
  await flow.getByRole("button", { name: "Tutup absensi" }).click();
  await expect(page.getByRole("heading", { name: "Riwayat", exact: false })).toBeVisible();
  await context.close();
});
test("login: tombol demo per persona (admin, 3 siswa, sponsor, super admin) langsung masuk ke peran itu", async ({ page }) => {
  const cases: [string, RegExp | string][] = [["Admin sekolah", /Selamat datang, Adinda/], ["Siswa · Alya", "Alya Putri Ramadhani"], ["Siswa · Bima", "Bima Aditya Pratama"], ["Siswa · Citra", "Citra Ayu Lestari"], ["Sponsor", /Selamat datang, Rizky/], ["Super admin", /Selamat datang, Dimas/]];
  for (const [label, heading] of cases) {
    await page.goto("/");
    await page.getByRole("button", { name: `Masuk demo sebagai ${label}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await page.getByRole("button", { name: "Keluar demo" }).click();
  }
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Bima" }).click();
  await expect(page.getByText("Sudah absen pukul 06:42")).toBeVisible();
});

test("sesi demo: keluar dari halaman admin lalu masuk sebagai siswa mendarat di beranda siswa", async ({ page }) => {
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Kehadiran" }).click();
  await expect(page).toHaveURL(/\/hub\/attendance$/);
  await page.getByRole("button", { name: "Keluar demo" }).click();
  await expect(page).toHaveURL(/\/hub$/);
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Alya" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  await expect(page.getByText("Halaman tidak ditemukan")).toHaveCount(0);
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption("SCHOOL_ADMIN");
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Kehadiran" }).click();
  await expect(page).toHaveURL(/\/hub\/attendance$/);
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption("STUDENT_BIMA");
  await expect(page).toHaveURL(/\/hub$/);
  await expect(page.getByRole("heading", { level: 1, name: "Bima Aditya Pratama" })).toBeVisible();
});

test("privasi demo: siswa hanya melihat rapor dan tagihan miliknya", async ({ page }) => {
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Citra" }).click();
  const others = ["Alya Putri Ramadhani", "Bima Aditya Pratama", "Daffa Rizky Saputra", "Elena Safira", "Farhan Maulana"];
  const menus: [string, RegExp][] = [["Rapor saya", /\/hub\/my-reports$/], ["Tagihan saya", /\/hub\/my-billing$/]];
  for (const [menu, url] of menus) {
    await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: menu }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByRole("heading", { level: 1, name: menu })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toBeVisible();
    for (const name of others) await expect(page.locator(".data-panel")).not.toContainText(name);
  }
  await expect(page.locator("tbody tr")).toHaveCount(3);
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Rapor saya" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Rapor saya" })).toBeVisible();
  await page.getByRole("button", { name: /Lihat detail Semester/ }).first().click();
  await expect(page.getByRole("dialog").getByRole("article", { name: "Rapor Citra Ayu Lestari" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cetak rapor" })).toBeVisible();
});

test("HP: tab bar kaca, geser maju saat masuk halaman dan geser kembali saat back, tanpa lapisan tumpang tindih", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await verifyPageSlides(page);
  await context.close();
});

test("HP: pindah tab lalu kembali mendarat di posisi gulir terakhir; tab aktif ditekan lagi = ke atas", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await verifyScrollMemory(page);
  await context.close();
});

test("tema sekolah (demo): preset dipratinjau, disimpan, berlaku untuk siswa, dan hilang saat keluar", async ({ page }) => {
  const primary = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim());
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Tema sekolah" }).click();
  await page.getByRole("button", { name: "Hijau Madani" }).click();
  expect(await primary()).toBe("#15803d");
  await page.getByRole("button", { name: "Simpan tema" }).click();
  await expect(page.getByRole("status")).toContainText("Tema demo diterapkan");
  await page.getByRole("combobox", { name: "Peran demo" }).selectOption("STUDENT");
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  expect(await primary()).toBe("#15803d");
  await page.getByRole("button", { name: "Keluar demo" }).click();
  await expect(page.getByRole("heading", { name: "Senang bertemu lagi." })).toBeVisible();
  expect(await primary()).toBe("#1d4ed8");
});

test("sesi demo: tombol kembali browser setelah ganti akun tidak membuka halaman peran sebelumnya", async ({ page }) => {
  await page.goto("/hub");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await page.getByRole("navigation", { name: "Navigasi utama" }).getByRole("link", { name: "Data siswa" }).click();
  await expect(page).toHaveURL(/\/hub\/students$/);
  await page.getByRole("button", { name: "Keluar demo" }).click();
  await page.getByRole("button", { name: "Masuk demo sebagai Siswa · Alya" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/hub$/);
  await expect(page.getByRole("heading", { level: 1, name: "Alya Putri Ramadhani" })).toBeVisible();
  await expect(page.getByText("Halaman tidak ditemukan")).toHaveCount(0);
});
