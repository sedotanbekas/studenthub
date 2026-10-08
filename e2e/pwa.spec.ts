import { spawnSync } from "node:child_process";
import { generateKeyPairSync, randomInt } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * PWA & Web Push (N3) lewat HTTP: manifest + ikon, /sw.js (tanpa cache), tautan manifest di /hub, endpoint Web Push
 * butuh login, dan alur langganan sesi web (super admin CLI: ganti sandi awal -> PUT -> keluar -> masuk lagi = sesi
 * baru tanpa langganan). Alur penuh butuh DATABASE_URL server & kunci VAPID di env server (CI: env job gate).
 */
const uid = `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
const NEW_PASSWORD = "E2eRahasia2026";

test("manifest: nama, start_url, tiga ikon PNG yang benar-benar ada", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const manifest = (await res.json()) as { name: string; start_url: string; display: string; icons: Array<{ src: string; purpose: string }> };
  expect([manifest.name, manifest.start_url, manifest.display]).toEqual(["Student Hub - Absensi, Rapor & Tagihan Sekolah", "/hub", "standalone"]);
  expect(manifest.icons.map((icon) => icon.purpose).sort()).toEqual(["any", "any", "maskable"]);
  for (const icon of manifest.icons) {
    const file = await request.get(icon.src);
    expect(file.status(), icon.src).toBe(200);
    expect(file.headers()["content-type"]).toContain("image/png");
  }
});

test("/sw.js: JavaScript, tanpa cache; fetch hanya untuk halaman offline, tanpa Cache Storage; /hub memuat tautan manifest", async ({ request }) => {
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(sw.headers()["cache-control"]).toContain("no-cache");
  const source = await sw.text();
  expect(source).toContain('addEventListener("push"');
  expect(source).toContain('addEventListener("fetch"');
  expect(source).toContain("Kamu sedang offline");
  expect(source).not.toContain("caches.");
  const hub = await request.get("/hub", { headers: { Accept: "text/html" } });
  expect(await hub.text()).toContain('rel="manifest"');
});

test("/pasang: halaman publik tanpa login — judul, kode QR SVG ke /pasang, tautan manifest, tautan dari halaman masuk", async ({ request }) => {
  const res = await request.get("/pasang", { headers: { Accept: "text/html" } });
  expect(res.status()).toBe(200);
  const html = await res.text();
  expect(html).toMatch(/<title>Pasang [^<]+<\/title>/);
  expect(html).toContain('rel="manifest"');
  expect(html).toMatch(/class="install-qr"[^>]*>.*?<svg [^>]*viewBox=/s);
  expect(html).toMatch(/https?:\/\/[^<"]+\/pasang/);
  const hub = await request.get("/hub", { headers: { Accept: "text/html" } });
  expect(await hub.text()).toContain('href="/pasang"');
});

test("endpoint Web Push membutuhkan login", async ({ request }) => {
  expect((await request.get("/api/v1/me/web-push")).status()).toBe(401);
  expect((await request.put("/api/v1/me/web-push/subscription", { data: {} })).status()).toBe(401);
});

function createSuperAdmin(email: string): string {
  const res = spawnSync(`pnpm exec tsx scripts/create-super-admin.ts --email ${email} --name "E2E PWA"`, { shell: true, encoding: "utf8", env: process.env });
  const match = /sementara[^:]*:\s*(\S+)/.exec(res.stdout ?? "");
  if (!match?.[1]) throw new Error(`Gagal membuat super admin E2E: ${res.stderr}`);
  return match[1];
}

async function login(request: APIRequestContext, identifier: string, password: string): Promise<string> {
  const res = await request.post("/api/v1/auth/login", { data: { identifier, password, platform: "WEB" } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { data: { accessToken: string } }).data.accessToken;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

function subscription() {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  const p256dh = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
  return { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${uid}`, expirationTime: null, keys: { p256dh, auth: Buffer.alloc(16, 7).toString("base64url") } };
}

test("langganan sesi web: aktif -> PUT -> terdaftar; keluar lalu masuk lagi = sesi baru belum berlangganan", async ({ request }) => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL server E2E tidak disetel (dibutuhkan CLI super admin)");
  const email = `e2e-pwa-${uid}@studenthub.test`;
  const temporary = createSuperAdmin(email);
  const first = await login(request, email, temporary);
  expect((await request.post("/api/v1/auth/change-password", { headers: auth(first), data: { currentPassword: temporary, newPassword: NEW_PASSWORD } })).status()).toBe(200);
  const token = await login(request, email, NEW_PASSWORD);
  const status = (await (await request.get("/api/v1/me/web-push", { headers: auth(token) })).json()) as { data: { enabled: boolean; subscribed: boolean } };
  test.skip(!status.data.enabled, "server E2E tanpa kunci VAPID");
  expect(status.data.subscribed).toBe(false);
  const put = await request.put("/api/v1/me/web-push/subscription", { headers: auth(token), data: subscription() });
  expect(put.status()).toBe(200);
  expect(((await (await request.get("/api/v1/me/web-push", { headers: auth(token) })).json()) as { data: { subscribed: boolean } }).data.subscribed).toBe(true);
  expect((await request.post("/api/v1/auth/logout", { headers: auth(token), data: {} })).status()).toBe(200);
  const again = await login(request, email, NEW_PASSWORD);
  expect(((await (await request.get("/api/v1/me/web-push", { headers: auth(again) })).json()) as { data: { subscribed: boolean } }).data.subscribed).toBe(false);
});
