import type { Page } from "@playwright/test";

/** Chromium headless memulai izin notifikasi "denied"; browser HP sungguhan "default" (belum ditanya). */
export async function notificationsUnasked(page: Page): Promise<void> {
  await page.addInitScript(() => { Object.defineProperty(Notification, "permission", { get: () => "default" }); });
}
