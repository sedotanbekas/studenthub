import { devices, test } from "@playwright/test";
import { verifyPageSlides } from "./page-slide-scenario";

// Mesin Safari iPhone: di sinilah lapisan view transition dulu tumpang tindih. Butuh
// `pnpm exec playwright install webkit`.
test.use({ ...devices["iPhone 13"], browserName: "webkit", launchOptions: {} });

test("Safari/WebKit (iPhone): transisi geser halaman tanpa lapisan tumpang tindih", async ({ page }) => {
  await verifyPageSlides(page);
});
