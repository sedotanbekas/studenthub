import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3030",
    viewport: { width: 1440, height: 1000 },
    // /sw.js punya handler fetch (halaman offline) & didaftarkan untuk akun yang masuk; permintaan dari halaman yang
    // dikendalikan service worker tidak dicegat page.route (mock /api/web). Uji SW sendiri: tests/browser/offline.spec.ts.
    serviceWorkers: "block",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    screenshot: "only-on-failure",
  },
  webServer: { command: "pnpm dev", url: "http://localhost:3030", reuseExistingServer: true, timeout: 120000, env: { TZ: "UTC" } },
});
