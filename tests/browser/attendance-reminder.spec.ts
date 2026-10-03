import { expect, test } from "@playwright/test";

/** Pengingat absen (N5, demo admin): kartu di Pengaturan sekolah — pratinjau jam kirim berubah langsung, simpan = pesan demo. */

test("demo admin: kartu Pengingat absen, pratinjau ikut menit, Simpan menampilkan pesan demo", async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem("studenthub_demo", "true");
    sessionStorage.setItem("studenthub_demo_role", "SCHOOL_ADMIN");
  });
  await page.goto("/hub/school-settings");
  const card = page.locator(".security-card", { has: page.getByRole("heading", { name: "Pengingat absen" }) });
  await expect(card).toContainText("Siswa yang belum absen menerima notifikasi HP pukul 07:00 — 15 menit sebelum jam masuk 07:15.");
  await expect(card).toContainText("1.012 dari 1.284 siswa aktif bisa menerima notifikasi HP.");
  const save = card.getByRole("button", { name: "Simpan" });
  await expect(save).toBeDisabled();
  await card.getByLabel("Menit sebelum jam masuk").fill("30");
  await expect(card).toContainText("pukul 06:45 — 30 menit sebelum jam masuk 07:15.");
  await card.getByLabel("Kirim pengingat absen").uncheck();
  await expect(card).toContainText("Mati — siswa tidak menerima pengingat absen.");
  await save.click();
  await expect(card.getByRole("alert")).toContainText("Mode demo");
  // Bukan tab/tombol halaman: operasi berkartu sendiri.
  await expect(page.getByRole("tab", { name: "Pengingat absen" })).toHaveCount(0);
});
