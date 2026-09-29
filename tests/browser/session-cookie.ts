import type { Page } from "@playwright/test";
import { SESSION_HINT } from "../../src/lib/frontend/session-hint";

/**
 * Sesi akun tiruan (/api/web di-mock): pasang cookie penanda sesi seperti yang dipasang proxy saat login,
 * agar server merender "Memuat…" lalu browser memulihkan sesi lewat GET /auth/me (bukan halaman masuk).
 */
export async function markSignedIn(page: Page, baseURL = "http://localhost:3030"): Promise<void> {
  await page.context().addCookies([{ name: SESSION_HINT, value: "1", url: baseURL }]);
}
