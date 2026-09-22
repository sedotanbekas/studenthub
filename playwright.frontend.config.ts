import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 45000,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3030",
    viewport: { width: 1440, height: 1000 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {},
    screenshot: "only-on-failure",
  },
  webServer: { command: "pnpm dev", url: "http://localhost:3030", reuseExistingServer: true, timeout: 120000, env: { TZ: "UTC" } },
});
