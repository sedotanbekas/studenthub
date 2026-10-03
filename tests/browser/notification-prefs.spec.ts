import { expect, test, type Page } from "@playwright/test";
import { operations } from "../../src/lib/frontend/catalog";
import { markSignedIn } from "./session-cookie";

/** Kabar sekolah per akun admin (N2): kartu di halaman Notifikasi (centang = terima) & aksi "Atur notifikasi" di demo. */

const identity = {
  user: { id: "user1", name: "Bu Rina", email: "rina@example.test", role: "SCHOOL_ADMIN", mustChangePassword: false, totpEnrollmentRequired: false },
  school: { id: "school1", name: "Sekolah Pengujian", timezone: "WIB" }, sponsor: null, permissions: [...new Set(operations.map(o => o.action))],
};
const envelope = (data: unknown) => ({ success: true, data, error: null, meta: { page: 1, total: 0, limit: 20, totalPages: 0 } });

async function signedIn(page: Page): Promise<{ bodies: unknown[] }> {
  const state = { bodies: [] as unknown[], muted: [] as string[] };
  await markSignedIn(page);
  await page.route("**/api/web/**", route => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace("/api/web", "");
    if (path === "/me/notification-preferences") {
      if (request.method() === "PUT") { const body = request.postDataJSON() as { mutedCategories: string[] }; state.bodies.push(body); state.muted = body.mutedCategories; }
      return route.fulfill({ json: envelope({ mutedCategories: state.muted, mutableCategories: ["FINANCE", "STUDENT_AFFAIRS"], updatedAt: null, updatedBy: null }) });
    }
    if (path === "/notifications/unread-count") return route.fulfill({ json: envelope({ total: 0, announcements: 0, personal: 0, latestCreatedAt: null }) });
    return route.fulfill({ json: envelope(path === "/auth/me" ? identity : []) });
  });
  return state;
}

test("kartu Notifikasi: matikan Keuangan -> PUT {mutedCategories:[FINANCE]} + ringkasan sebab-akibat", async ({ page }) => {
  const state = await signedIn(page);
  await page.goto("/hub/notifications");
  const card = page.locator(".security-card", { hasText: "Kabar sekolah untuk akun ini" });
  await expect(card).toContainText("Semua kabar sekolah dikirim ke akun ini.");
  await card.getByRole("button", { name: "Atur" }).click();
  const save = card.getByRole("button", { name: "Simpan pilihan" });
  await expect(save).toBeDisabled();
  await card.getByRole("checkbox", { name: /Keuangan/ }).uncheck();
  await save.click();
  await expect(page.getByText("Tersimpan. Kabar Keuangan tidak dikirim ke akun ini.")).toBeVisible();
  expect(state.bodies).toEqual([{ mutedCategories: ["FINANCE"] }]);
  await expect(card).toContainText("Kabar Keuangan tidak dikirim ke akun ini.");
});

test("demo: Admin & guru -> Atur notifikasi menampilkan centang per kategori; simpan ditolak dengan pesan demo", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Masuk demo sebagai Admin sekolah" }).click();
  await page.getByRole("navigation").getByRole("link", { name: "Admin & guru" }).click();
  await page.getByRole("button", { name: /Lihat detail Bu Rina/ }).click();
  const detail = page.getByRole("dialog");
  await expect(detail).toContainText("Keuangan");
  await detail.getByRole("button", { name: "Atur notifikasi" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: /Keuangan/ })).not.toBeChecked();
  await expect(dialog.getByRole("checkbox", { name: /Kesiswaan/ })).toBeChecked();
  await expect(dialog).toContainText("admin utama tetap menerimanya");
  await dialog.getByRole("button", { name: "Simpan & lanjutkan" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Mode demo");
});

test("respons pilihan tak terduga -> kartu galat + Coba lagi (tidak pernah 'semua dikirim', halaman tetap jalan)", async ({ page }) => {
  await markSignedIn(page);
  await page.route("**/api/web/**", route => {
    const path = new URL(route.request().url()).pathname.replace("/api/web", "");
    return route.fulfill({ json: envelope(path === "/auth/me" ? identity : []) });
  });
  await page.goto("/hub/notifications");
  const card = page.locator(".security-card", { hasText: "Kabar sekolah untuk akun ini" });
  await expect(card).toContainText("Pilihan notifikasi belum berhasil dimuat.");
  await expect(card.getByRole("button", { name: "Coba lagi" })).toBeVisible();
  await expect(card).not.toContainText("Semua kabar sekolah dikirim");
  await expect(page.getByRole("button", { name: "Tandai semua dibaca" }).first()).toBeVisible();
});
