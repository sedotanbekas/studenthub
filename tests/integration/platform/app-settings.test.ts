/**
 * Pengaturan aplikasi (App Setting, 2026-10-07): identitas aplikasi publik, ubah nama & logo oleh super admin
 * (diaudit, cache branding langsung kosong), aturan logo, dan matriks peran (403).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { GET as brandingRoute } from "@/app/api/v1/app/branding/route";
import { GET as iconRoute } from "@/app/api/v1/app/icon/[variant]/route";
import { GET as logoRoute } from "@/app/api/v1/app/logo/route";
import { DELETE as removeLogoRoute, POST as uploadLogoRoute } from "@/app/api/v1/platform/app-settings/logo/route";
import { GET as settingsGet, PATCH as settingsPatch } from "@/app/api/v1/platform/app-settings/route";
import { invalidateBranding } from "@/lib/app-settings/service";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { callMultipart, superFx, webToken } from "../ads/fixtures";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";

interface SettingsBody { appName: string; logoUrl: string | null; defaultAppName: string; logoUpdatedAt: string | null }

let superToken = "";
let superId = "";

async function resetBranding(): Promise<void> {
  await prisma.appBranding.update({ where: { id: 1 }, data: { appName: "Student Hub", logo: null, logoMimeType: null, logoUpdatedAt: null } });
  invalidateBranding();
}

before(async () => {
  const fx = await superFx();
  superToken = fx.token;
  superId = fx.user.id;
  resetAllLimiters();
  await resetBranding();
});
after(async () => {
  await resetBranding();
  await disconnect();
});

const logoPng = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 4, background: { r: 120, g: 40, b: 220, alpha: 0.5 } } }).png().toBuffer();

async function upload(width: number, height: number) {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(await logoPng(width, height))], { type: "image/png" }), "logo.png");
  return callMultipart<Envelope<SettingsBody>>(uploadLogoRoute, { url: "/api/v1/platform/app-settings/logo", form, bearer: superToken });
}

test("branding publik: tanpa token, nama bawaan & tanpa logo", async () => {
  const res = await callRoute<Envelope<{ appName: string; logoUrl: string | null }>>(brandingRoute, { method: "GET", url: "/api/v1/app/branding" });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body?.data.appName, res.body?.data.logoUrl], ["Student Hub", null]);
  const logo = await callRoute<Envelope>(logoRoute, { method: "GET", url: "/api/v1/app/logo" });
  assert.equal(logo.status, 404);
  assert.equal(logo.body?.error?.code, "LOGO_NOT_FOUND");
});

test("ubah nama: dirapikan, diaudit, branding publik langsung berganti; nama tidak layak 400", async () => {
  const res = await callRoute<Envelope<SettingsBody>>(settingsPatch, { method: "PATCH", url: "/api/v1/platform/app-settings", bearer: superToken, json: { appName: "  Sekolah   Pintar " } });
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.appName, "Sekolah Pintar");
  assert.equal(res.body?.data.defaultAppName, "Student Hub");
  const audit = await prisma.auditLog.findFirst({ where: { action: "platform.app_settings.update", actorId: superId }, orderBy: { createdAt: "desc" } });
  assert.deepEqual([(audit?.before as { appName?: string } | null)?.appName, (audit?.after as { appName?: string } | null)?.appName], ["Student Hub", "Sekolah Pintar"]);
  const pub = await callRoute<Envelope<{ appName: string }>>(brandingRoute, { method: "GET", url: "/api/v1/app/branding" });
  assert.equal(pub.body?.data.appName, "Sekolah Pintar");
  for (const appName of ["<b>x</b>", "A", "x".repeat(41)]) {
    const bad = await callRoute<Envelope>(settingsPatch, { method: "PATCH", url: "/api/v1/platform/app-settings", bearer: superToken, json: { appName } });
    assert.equal(bad.status, 400, appName);
    assert.equal(bad.body?.error?.code, "VALIDATION_FAILED");
  }
});

test("logo: unggah -> WebP <= 512 px + semua ikon (favicon, iOS, PWA, badge, splash) + geometri masker; terlalu kecil 422; hapus -> kembali bawaan", async () => {
  const small = await upload(32, 32);
  assert.equal(small.status, 422);
  assert.equal((small.body as Envelope | null)?.error?.code, "LOGO_INVALID");
  const ok = await upload(600, 400);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const logoUrl = ok.body?.data.logoUrl ?? "";
  assert.match(logoUrl, /^\/api\/v1\/app\/logo\?v=\d+$/);
  const logo = await callRoute(logoRoute, { method: "GET", url: logoUrl });
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get("content-type"), "image/webp");
  assert.equal(logo.headers.get("cache-control"), "public, max-age=86400");
  const meta = await sharp(Buffer.from(await logo.response.arrayBuffer())).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ["webp", 512, 341, true]);
  // Semua ikon ikut logo unggahan: ukuran kanvas per varian, latar putih untuk iOS/PWA.
  for (const [variant, size, format] of [["favicon", 96, "png"], ["apple", 180, "png"], ["app-192", 192, "png"], ["maskable-512", 512, "png"], ["badge", 96, "png"], ["splash", 512, "webp"]] as const) {
    const icon = await callRoute(iconRoute, { method: "GET", url: `/api/v1/app/icon/${variant}?v=1`, params: { variant } });
    assert.equal(icon.status, 200, variant);
    const m = await sharp(Buffer.from(await icon.response.arrayBuffer())).metadata();
    assert.deepEqual([m.format, m.width, m.height], [format, size, size], variant);
  }
  // Bentuk masker splash = siluet logo (persegi panjang di tengah kanvas), bukan tanda "S".
  const stored = await prisma.appBranding.findUniqueOrThrow({ where: { id: 1 }, select: { logoGeometry: true } });
  const geometry = stored.logoGeometry as { ox: number; oy: number; inscribed: number };
  assert.ok(Math.abs(geometry.ox - 0.5) < 0.05 && Math.abs(geometry.oy - 0.5) < 0.05 && geometry.inscribed > 0.2, JSON.stringify(geometry));
  const audit = await prisma.auditLog.findFirst({ where: { action: "platform.app_logo.update", actorId: superId }, orderBy: { createdAt: "desc" } });
  assert.equal((audit?.after as { hasLogo?: boolean } | null)?.hasLogo, true);
  const removed = await callRoute<Envelope<SettingsBody>>(removeLogoRoute, { method: "DELETE", url: "/api/v1/platform/app-settings/logo", bearer: superToken });
  assert.equal(removed.status, 200);
  assert.equal(removed.body?.data.logoUrl, null);
  assert.equal((await callRoute(logoRoute, { method: "GET", url: "/api/v1/app/logo" })).status, 404);
  assert.equal((await callRoute(iconRoute, { method: "GET", url: "/api/v1/app/icon/favicon", params: { variant: "favicon" } })).status, 404);
  const bad = await callRoute<Envelope>(iconRoute, { method: "GET", url: "/api/v1/app/icon/x", params: { variant: "x" } });
  assert.equal(bad.status, 400);
});

test("hak: admin sekolah & tanpa token tidak boleh membaca/mengubah pengaturan aplikasi", async () => {
  const school = await createSchool();
  const adminToken = await webToken((await createSchoolAdmin(school.id)).id);
  assert.equal((await callRoute(settingsGet, { method: "GET", url: "/api/v1/platform/app-settings", bearer: adminToken })).status, 403);
  assert.equal((await callRoute(settingsPatch, { method: "PATCH", url: "/api/v1/platform/app-settings", bearer: adminToken, json: { appName: "Sekolahku" } })).status, 403);
  assert.equal((await callRoute(settingsGet, { method: "GET", url: "/api/v1/platform/app-settings" })).status, 401);
  const own = await callRoute<Envelope<SettingsBody>>(settingsGet, { method: "GET", url: "/api/v1/platform/app-settings", bearer: superToken });
  assert.equal(own.status, 200);
});
