import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import sharp from "sharp";
import { base32Decode, totpCodeAt, totpStep } from "../src/lib/auth/totp-rules";

/**
 * Alur P4 lewat HTTP (server nyata): super admin (CLI, daftar TOTP) -> sekolah + siswa aktif -> sponsor (dibuat, disetujui) ->
 * banner -> iklan -> review -> top-up + bukti -> persetujuan -> siswa melihat slider, impresi, klik -> analitik &
 * kartu saldo sponsor. Siswa baru aktif (< 7 hari) sehingga kliknya SUSPECT (dicatat, TIDAK ditagih) — saldo tetap
 * utuh; jalur klik ditagih + 20 klik paralel diuji integration test (tests/integration/ads). Butuh DATABASE_URL
 * yang sama dengan server (CI: job gate).
 */
const uid = `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
const NEW_PASSWORD = "E2eRahasia2026";
type Json = Record<string, unknown>;

function createSuperAdmin(email: string): string {
  const res = spawnSync(`pnpm exec tsx scripts/create-super-admin.ts --email ${email} --name "E2E Super Admin"`, { shell: true, encoding: "utf8", env: process.env });
  const match = /sementara[^:]*:\s*(\S+)/.exec(res.stdout ?? "");
  if (!match?.[1]) throw new Error(`Gagal membuat super admin E2E: ${res.stderr}`);
  return match[1];
}

async function data<T = Json>(res: Awaited<ReturnType<APIRequestContext["get"]>>, status = 200): Promise<T> {
  const body = (await res.json()) as { data: T; error: unknown };
  expect(res.status(), JSON.stringify(body.error)).toBe(status);
  return body.data;
}

async function login(request: APIRequestContext, identifier: string, password: string, mobile = false): Promise<string> {
  const body = { identifier, password, platform: mobile ? "ANDROID" : "WEB", ...(mobile ? { deviceId: `e2e-device-${uid}` } : {}) };
  return (await data<{ accessToken: string }>(await request.post("/api/v1/auth/login", { data: body }))).accessToken;
}

/** Login dengan kata sandi sementara, ganti, lalu login ulang (akun baru wajib ganti kata sandi). */
async function firstLogin(request: APIRequestContext, identifier: string, temporary: string, mobile = false): Promise<string> {
  const token = await login(request, identifier, temporary, mobile);
  const changed = await request.post("/api/v1/auth/change-password", { headers: auth(token), data: { currentPassword: temporary, newPassword: NEW_PASSWORD } });
  expect(changed.status()).toBe(200);
  return login(request, identifier, NEW_PASSWORD, mobile);
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * Super admin baru wajib TOTP (P5): sebelum mendaftar, aksi /platform/* ditolak; daftar lewat setup -> confirm
 * (kode dihitung dari rahasia yang dikembalikan), lalu login ulang tanpa kode -> TOTP_REQUIRED.
 */
async function enrollTotp(request: APIRequestContext, email: string, token: string): Promise<void> {
  const blocked = await request.get("/api/v1/platform/audit-logs", { headers: auth(token) });
  expect(blocked.status()).toBe(403);
  expect(((await blocked.json()) as { error: { code: string } }).error.code).toBe("TOTP_ENROLLMENT_REQUIRED");
  const { secret } = await data<{ secret: string }>(await request.post("/api/v1/me/totp/setup", { headers: auth(token) }));
  const code = totpCodeAt(base32Decode(secret), totpStep(new Date()));
  await data(await request.post("/api/v1/me/totp/confirm", { headers: auth(token), data: { code } }));
  const relogin = await request.post("/api/v1/auth/login", { data: { identifier: email, password: NEW_PASSWORD, platform: "WEB" } });
  expect(relogin.status()).toBe(401);
  expect(((await relogin.json()) as { error: { code: string } }).error.code).toBe("TOTP_REQUIRED");
}
async function setupSchool(request: APIRequestContext, sa: string): Promise<{ schoolId: string; nisn: string; temporaryPassword: string }> {
  const school = await data<{ id: string }>(await request.post("/api/v1/platform/schools", {
    headers: auth(sa), data: { name: `SMP E2E ${uid}`, provinceCode: "32", cityCode: "32.73", latitude: -6.9147, longitude: 107.6098, timezone: "WIB" },
  }), 201);
  const q = `?schoolId=${school.id}`;
  const y = new Date().getUTCMonth() >= 6 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  const year = await data<{ id: string }>(await request.post(`/api/v1/school/academic-years${q}`, {
    headers: auth(sa), data: { name: `${y}/${y + 1}`, startDate: `${y}-07-13`, endDate: `${y + 1}-06-26` },
  }), 201);
  const term = await data<{ id: string }>(await request.post(`/api/v1/school/academic-years/${year.id}/terms${q}`, {
    headers: auth(sa), data: { semester: "GANJIL", startDate: `${y}-07-13`, endDate: `${y}-12-19` },
  }), 201);
  await data(await request.put(`/api/v1/school/active-term${q}`, { headers: auth(sa), data: { termId: term.id } }));
  const klass = await data<{ id: string }>(await request.post(`/api/v1/school/classes${q}`, { headers: auth(sa), data: { academicYearId: year.id, name: "VII-E2E", gradeLevel: 7 } }), 201);
  const nisn = String(randomInt(1_000_000_000, 9_999_999_999));
  const student = await data<{ temporaryPassword: string }>(await request.post(`/api/v1/school/students${q}`, {
    headers: auth(sa),
    data: {
      nisn, nis: `E${uid}`.slice(0, 20), name: "Siswa E2E", gender: "MALE", birthPlace: "Bandung", birthDate: "2012-05-17",
      address: "Jl. Uji No. 1", guardianName: "Wali E2E", guardianPhone: "081234567890", currentClassId: klass.id,
    },
  }), 201);
  return { schoolId: school.id, nisn, temporaryPassword: student.temporaryPassword };
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer();
}

test("P4: sponsor -> iklan -> top-up -> tayang -> klik -> analitik & saldo", async ({ request }) => {
  test.skip(!process.env.DATABASE_URL, "DATABASE_URL server E2E tidak disetel (dibutuhkan CLI super admin)");
  test.setTimeout(120_000);
  const saEmail = `e2e-sa-${uid}@studenthub.test`;
  const sa = await firstLogin(request, saEmail, createSuperAdmin(saEmail));
  await enrollTotp(request, saEmail, sa);
  const { schoolId, nisn, temporaryPassword } = await setupSchool(request, sa);

  const spEmail = `e2e-sponsor-${uid}@studenthub.test`;
  const created = await data<{ sponsor: { id: string }; temporaryPassword: string }>(await request.post("/api/v1/platform/sponsors", {
    headers: auth(sa),
    data: { companyName: `PT E2E ${uid}`, contactName: "Kontak E2E", contactEmail: spEmail, contactPhone: "+6281200000001", login: { name: "Sponsor E2E", email: spEmail } },
  }), 201);
  const sponsorId = created.sponsor.id;
  await data(await request.post(`/api/v1/platform/sponsors/${sponsorId}/approve`, { headers: auth(sa) }));
  const sp = await firstLogin(request, spEmail, created.temporaryPassword);

  const banner = await data<{ fileId: string }>(await request.post("/api/v1/sponsor/banners", {
    headers: auth(sp), multipart: { file: { name: "banner.png", mimeType: "image/png", buffer: await png(1200, 600) } },
  }), 201);
  const now = Date.now();
  const ad = await data<{ id: string }>(await request.post("/api/v1/sponsor/ads", {
    headers: auth(sp),
    data: {
      title: "Promo E2E", imageFileId: banner.fileId, linkType: "EXTERNAL_URL", targetUrl: "https://promo.example.co.id/e2e",
      startAt: new Date(now - 3_600_000).toISOString(), endAt: new Date(now + 7 * 86_400_000).toISOString(), targetScope: "SCHOOL", targets: { schoolIds: [schoolId] },
    },
  }), 201);
  const submitted = await data<{ submittedAt: string; cpcAmount: number }>(await request.post(`/api/v1/sponsor/ads/${ad.id}/submit`, { headers: auth(sp) }));
  await data(await request.post(`/api/v1/platform/ads/${ad.id}/approve`, { headers: auth(sa), data: { submittedAt: submitted.submittedAt } }));

  const today = new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
  const topUp = await data<{ id: string }>(await request.post("/api/v1/sponsor/topups", {
    headers: auth(sp),
    multipart: { amount: "250000", transferDate: today, senderName: "PT E2E", senderBank: "BCA", file: { name: "bukti.png", mimeType: "image/png", buffer: await png(600, 900) } },
  }), 201);
  await data(await request.post(`/api/v1/platform/topups/${topUp.id}/approve`, { headers: auth(sa) }));

  const student = await firstLogin(request, nisn, temporaryPassword, true);
  const slider = await data<{ ads: Array<{ adId: string; token: string; imageUrl: string }> }>(await request.get("/api/v1/student/ads", { headers: auth(student) }));
  const served = slider.ads.find((a) => a.adId === ad.id);
  expect(served, "iklan tayang untuk sekolah target").toBeTruthy();
  const token = served?.token ?? "";
  expect(await data(await request.post("/api/v1/student/ads/impressions", { headers: auth(student), data: { events: [{ token }] } }))).toEqual({ accepted: 1, duplicate: 0, rejected: 0 });
  expect(await data(await request.post("/api/v1/student/ads/clicks", { headers: auth(student), data: { token } }))).toEqual({ targetUrl: "https://promo.example.co.id/e2e", linkType: "EXTERNAL_URL" });

  const summary = await data<{ kpis: Record<string, { value: number | null }> }>(await request.get("/api/v1/sponsor/analytics/summary?preset=7d", { headers: auth(sp) }));
  expect([summary.kpis.impressions?.value, summary.kpis.clicks?.value, summary.kpis.ctr?.value, summary.kpis.spend?.value]).toEqual([1, 1, 100, 0]);
  const card = await data<{ balance: number; totalTopUp: number }>(await request.get("/api/v1/sponsor/balance", { headers: auth(sp) }));
  expect([card.balance, card.totalTopUp]).toEqual([250_000, 250_000]);
  const ledger = await data<Array<{ type: string; balanceAfter: number }>>(await request.get("/api/v1/sponsor/ledger", { headers: auth(sp) }));
  expect(ledger.map((e) => [e.type, e.balanceAfter])).toEqual([["TOPUP", 250_000]]);
});
