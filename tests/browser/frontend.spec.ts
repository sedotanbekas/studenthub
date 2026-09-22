import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { demoStudents, demoSummary } from "../../src/lib/frontend/demo";

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
  await page.getByRole("button", { name: "Jelajahi tampilan demo" }).click();
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
  await page.getByRole("button", { name: "Jelajahi tampilan demo" }).click();
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
  await page.goto("/"); await page.getByRole("button", { name: "Jelajahi tampilan demo" }).click();
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
