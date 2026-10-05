/**
 * "Masuk sebagai" (pemilik 2026-10-05): super admin membuka akun lain (bukan super admin) dalam sesi terpisah 30 menit
 * tanpa kata sandinya; sesi asli pemilik akun tidak tersentuh; keamanan akun pemilik ditolak; semua tercatat di audit.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as endRoute } from "@/app/api/v1/auth/impersonation/end/route";
import { POST as changePasswordRoute } from "@/app/api/v1/auth/change-password/route";
import { POST as logoutAllRoute } from "@/app/api/v1/auth/logout-all/route";
import { POST as impersonateRoute } from "@/app/api/v1/platform/users/[id]/impersonate/route";
import { GET as getStudentRoute, PATCH as patchStudentRoute } from "@/app/api/v1/school/students/[id]/route";
import { GET as todayRoute } from "@/app/api/v1/student/attendance/today/route";
import { IMPERSONATION_TTL_MS } from "@/lib/auth/impersonation-rules";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, createSuperAdmin } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { loginOk, me, type TokensBody } from "./helpers";

beforeEach(resetAllLimiters);
after(disconnect);

const impersonate = (bearer: string, id: string) =>
  callRoute<Envelope<TokensBody>>(impersonateRoute, { method: "POST", url: `/api/v1/platform/users/${id}/impersonate`, params: { id }, bearer });
const end = (bearer: string) => callRoute<Envelope<{ ended: boolean }>>(endRoute, { method: "POST", url: "/api/v1/auth/impersonation/end", bearer });

async function superAdminToken(): Promise<{ id: string; token: string }> {
  const sa = await createSuperAdmin();
  return { id: sa.id, token: (await createSessionToken(sa.id, { platform: "WEB", deviceId: null })).token };
}

test("masuk sebagai siswa: token berlaku sebagai siswa 30 menit, /auth/me memuat penanda, sesi asli tetap hidup, audit tercatat", async () => {
  const sa = await superAdminToken();
  const school = await createSchool();
  const { user } = await createStudent(school.id);
  const real = await createSessionToken(user.id);
  const started = Date.now();
  const res = await impersonate(sa.token, user.id);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const tokens = res.body?.data as TokensBody;
  assert.equal(tokens.user.id, user.id);
  const expires = Date.parse(tokens.refreshTokenExpiresAt);
  assert.ok(expires >= started + IMPERSONATION_TTL_MS - 5_000 && expires <= Date.now() + IMPERSONATION_TTL_MS);

  const profile = await me(tokens.accessToken);
  assert.equal(profile.status, 200);
  const impersonation = (profile.body?.data as unknown as { impersonation: { by: { id: string }; expiresAt: string } | null }).impersonation;
  assert.equal(impersonation?.by.id, sa.id);
  assert.equal((await me(real.token)).status, 200, "sesi asli siswa tidak dicabut");
  assert.equal((await callRoute(todayRoute, { method: "GET", url: "/api/v1/student/attendance/today", bearer: tokens.accessToken })).status, 200, "status absen hari ini boleh dilihat");

  const audit = await prisma.auditLog.findFirst({ where: { action: "user.impersonate_start", entityId: user.id } });
  assert.equal(audit?.actorId, sa.id);
});

test("selama Masuk sebagai: keamanan akun pemilik ditolak; tindakan tercatat dengan impersonatorId; Akhiri mencabut sesi", async () => {
  const sa = await superAdminToken();
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const tokens = (await impersonate(sa.token, admin.id)).body?.data as TokensBody;
  const bearer = tokens.accessToken;
  const changed = await callRoute(changePasswordRoute, { method: "POST", url: "/api/v1/auth/change-password", bearer, json: { currentPassword: "x", newPassword: "KataSandiBaru#2026" } });
  assert.equal(changed.status, 403);
  assert.equal(changed.body?.error?.code, "IMPERSONATION_FORBIDDEN");
  assert.equal((await callRoute(logoutAllRoute, { method: "POST", url: "/api/v1/auth/logout-all", bearer })).body?.error?.code, "IMPERSONATION_FORBIDDEN");

  const ended = await end(bearer);
  assert.equal(ended.status, 200, JSON.stringify(ended.body));
  assert.equal((await me(bearer)).status, 401, "sesi Masuk sebagai dicabut");
  const audit = await prisma.auditLog.findFirst({ where: { action: "user.impersonate_end", entityId: admin.id } });
  assert.equal(audit?.actorId, sa.id, "dicatat atas nama super admin yang bertindak");
  assert.equal(audit?.schoolId, school.id, "tampil di riwayat aktivitas sekolah");
  assert.equal((await end((await createSessionToken(admin.id)).token)).body?.error?.code, "NOT_IMPERSONATING");
});

test("ditolak: target super admin, akun nonaktif, id asing; hanya super admin yang boleh memakai", async () => {
  const sa = await superAdminToken();
  const other = await createSuperAdmin();
  const notAllowed = await impersonate(sa.token, other.id);
  assert.equal(notAllowed.status, 403);
  assert.equal(notAllowed.body?.error?.code, "IMPERSONATION_NOT_ALLOWED");
  const school = await createSchool();
  const inactive = await createSchoolAdmin(school.id, { isActive: false });
  assert.equal((await impersonate(sa.token, inactive.id)).body?.error?.code, "ACCOUNT_INACTIVE");
  assert.equal((await impersonate(sa.token, "tidak-ada-id")).status, 404);
  const adminToken = (await createSessionToken((await createSchoolAdmin(school.id)).id)).token;
  assert.equal((await impersonate(adminToken, inactive.id)).status, 403);
});

test("super admin dinonaktifkan -> sesi Masuk sebagai miliknya langsung tidak berlaku", async () => {
  const sa = await superAdminToken();
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const tokens = (await impersonate(sa.token, admin.id)).body?.data as TokensBody;
  assert.equal((await me(tokens.accessToken)).status, 200);
  await prisma.user.update({ where: { id: sa.id }, data: { isActive: false } });
  assert.equal((await me(tokens.accessToken)).status, 401);
});

test("login asli pemilik akun: sesi Masuk sebagai tidak dihitung batas sesi dan tidak diusir", async () => {
  const sa = await superAdminToken();
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  for (let i = 0; i < 5; i += 1) await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
  const tokens = (await impersonate(sa.token, admin.id)).body?.data as TokensBody;
  await loginOk(admin.email ?? "");
  const revoked = await prisma.authSession.count({ where: { userId: admin.id, revokedAt: { not: null } } });
  assert.equal(revoked, 1, "batas 5 sesi admin: hanya satu sesi asli tertua yang diusir");
  assert.equal((await me(tokens.accessToken)).status, 200, "sesi Masuk sebagai tetap hidup");
});

test("mode lihat: perubahan data atas nama pemilik akun ditolak; membaca tetap boleh", async () => {
  const sa = await superAdminToken();
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const { student } = await createStudent(school.id);
  const bearer = ((await impersonate(sa.token, admin.id)).body?.data as TokensBody).accessToken;
  const url = `/api/v1/school/students/${student.id}`;
  const read = await callRoute(getStudentRoute, { method: "GET", url, params: { id: student.id }, bearer });
  assert.equal(read.status, 200);
  const write = await callRoute(patchStudentRoute, { method: "PATCH", url, params: { id: student.id }, bearer, json: { name: "Diubah Super Admin" } });
  assert.equal(write.status, 403);
  assert.equal(write.body?.error?.code, "IMPERSONATION_FORBIDDEN");
  const start = await prisma.auditLog.findFirst({ where: { action: "user.impersonate_start", entityId: admin.id } });
  assert.equal(start?.schoolId, school.id);
});

test("super admin keluar dari semua perangkat -> sesi Masuk sebagai yang ia buka ikut dicabut", async () => {
  const sa = await superAdminToken();
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const tokens = (await impersonate(sa.token, admin.id)).body?.data as TokensBody;
  assert.equal((await callRoute(logoutAllRoute, { method: "POST", url: "/api/v1/auth/logout-all", bearer: sa.token })).status, 200);
  assert.equal((await me(tokens.accessToken)).status, 401);
});
