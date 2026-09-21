import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listProvinces } from "@/app/api/v1/regions/provinces/route";
import { GET as listCities } from "@/app/api/v1/regions/provinces/[code]/cities/route";
import { GET as enums } from "@/app/api/v1/meta/enums/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute } from "../helpers/request";

let adminToken = "";
let adminUserId = "";
let schoolId = "";

before(async () => {
  resetAllLimiters();
  const school = await createSchool();
  schoolId = school.id;
  const admin = await createSchoolAdmin(school.id);
  adminUserId = admin.id;
  adminToken = (await createSessionToken(admin.id, { platform: "WEB", deviceId: null })).token;
});
after(disconnect);

test("route publik mengembalikan envelope + header keamanan", async () => {
  const res = await callRoute(enums, { method: "GET", url: "/api/v1/meta/enums" });
  assert.equal(res.status, 200);
  assert.equal(res.body?.success, true);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.match(res.headers.get("x-request-id") ?? "", /^[A-Za-z0-9-]{8,64}$/);
});

test("X-Request-Id klien dipakai ulang bila formatnya aman", async () => {
  const res = await callRoute(enums, { method: "GET", url: "/api/v1/meta/enums", headers: { "x-request-id": "req-abcdef12" } });
  assert.equal(res.headers.get("x-request-id"), "req-abcdef12");
});

test("tanpa token -> 401 UNAUTHENTICATED; token rusak -> 401", async () => {
  const anon = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces" });
  assert.equal(anon.status, 401);
  assert.equal(anon.body?.error?.code, "UNAUTHENTICATED");
  const bad = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: "bukan.jwt.valid" });
  assert.equal(bad.status, 401);
});

test("admin sekolah dengan sesi hidup -> 200 daftar provinsi", async () => {
  const res = await callRoute<{ data: Array<{ code: string }> }>(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.length, 38);
});

test("params divalidasi zod (400) dan provinsi tak dikenal -> 404", async () => {
  const bad = await callRoute(listCities, { method: "GET", url: "/api/v1/regions/provinces/x/cities", bearer: adminToken, params: { code: "x" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body?.error?.code, "VALIDATION_FAILED");
  const missing = await callRoute(listCities, { method: "GET", url: "/api/v1/regions/provinces/99/cities", bearer: adminToken, params: { code: "99" } });
  assert.equal(missing.status, 404);
  const ok = await callRoute<{ data: unknown[] }>(listCities, { method: "GET", url: "/api/v1/regions/provinces/32/cities", bearer: adminToken, params: { code: "32" } });
  assert.equal(ok.status, 200);
  assert.ok((ok.body?.data.length ?? 0) > 20);
});

test("peran siswa ditolak 403 FORBIDDEN untuk aksi region.read", async () => {
  const { user } = await createStudent(schoolId);
  const { token } = await createSessionToken(user.id);
  const res = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: token });
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "FORBIDDEN");
});

test("mustChangePassword -> 403 PASSWORD_CHANGE_REQUIRED", async () => {
  const admin = await createSchoolAdmin(schoolId);
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: true } });
  const { token } = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
  const res = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: token });
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
});

test("sesi dicabut atau akun/sekolah nonaktif berlaku seketika", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const s1 = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
  await prisma.authSession.update({ where: { id: s1.sessionId }, data: { revokedAt: new Date() } });
  const revoked = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: s1.token });
  assert.equal(revoked.body?.error?.code, "SESSION_INVALID");
  const s2 = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
  await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
  const inactive = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: s2.token });
  assert.equal(inactive.status, 401);
  assert.equal(inactive.body?.error?.code, "ACCOUNT_INACTIVE");
});

test("token kedaluwarsa -> 401 TOKEN_EXPIRED", async () => {
  const past = new Date(Date.now() - 3_600_000);
  const { token } = await createSessionToken(adminUserId, { platform: "WEB", deviceId: null, now: past });
  const res = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: token });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "TOKEN_EXPIRED");
});

test("skema Basic (dari /docs) dianggap anonim", async () => {
  const res = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", headers: { authorization: "Basic YTpi" } });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "UNAUTHENTICATED");
});
