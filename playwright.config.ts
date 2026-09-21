import { defineConfig } from "@playwright/test";

// E2E tingkat API (tanpa browser): memakai fixture `request` Playwright.
const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:3030";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL, extraHTTPHeaders: { Accept: "application/json" } },
  webServer: process.env.CI
    ? { command: "pnpm start -p 3030", url: `${baseURL}/api/health`, timeout: 120_000, reuseExistingServer: false }
    : undefined,
});
