/**
 * Admin utama sekolah mengelola akun admin tambahan (guru/wali kelas) — keputusan pemilik 2026-10-02.
 * /school/admins*: admin utama mengelola; admin tambahan hanya melihat; super admin lewat ?schoolId=.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/school/admins/route";
import { GET as getRoute, PATCH as updateRoute } from "@/app/api/v1/school/admins/[id]/route";
import { POST as activateRoute } from "@/app/api/v1/school/admins/[id]/activate/route";
import { POST as deactivateRoute } from "@/app/api/v1/school/admins/[id]/deactivate/route";
import { POST as resetRoute } from "@/app/api/v1/school/admins/[id]/reset-password/route";
import { POST as revokeRoute } from "@/app/api/v1/school/admins/[id]/revoke-sessions/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { loginOk, me } from "../auth/helpers";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, createSuperAdmin, uniqEmail, type TestUser } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope, type HttpMethod } from "../helpers/request";

beforeEach(resetAllLimiters);
after(disconnect);

interface AdminBody {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly isPrimary: boolean;
  readonly isActive: boolean;
  readonly mustChangePassword: boolean;
}

/** Admin utama = admin sekolah dengan primarySchoolId (masuk dengan NPSN). */
async function primaryAdmin(schoolId: string): Promise<TestUser> {
  const admin = await createSchoolAdmin(schoolId);
  return prisma.user.update({ where: { id: admin.id }, data: { primarySchoolId: schoolId } });
}

async function schoolWithPrimary() {
  const school = await createSchool();
  const primary = await primaryAdmin(school.id);
  const token = (await createSessionToken(primary.id, { platform: "WEB", deviceId: null })).token;
  return { school, primary, token };
}

function call<T>(handler: AnyRouteHandler, method: HttpMethod, path: string, bearer: string, extra: { id?: string; json?: unknown } = {}) {
  return callRoute<Envelope<T>>(handler, {
    method,
    url: `/api/v1/school/admins${path}`,
    bearer,
    ...(extra.id ? { params: { id: extra.id } } : {}),
    ...(extra.json !== undefined ? { json: extra.json } : {}),
  });
}

test("admin utama membuat akun guru: kata sandi sementara sekali, wajib ganti sandi, masuk dengan email, tercatat di audit", async () => {
  const { school, token } = await schoolWithPrimary();
  const email = uniqEmail("guru");
  const res = await call<{ admin: AdminBody; temporaryPassword?: string }>(createRoute as AnyRouteHandler, "POST", "", token, {
    json: { name: "Bu Rina (Wali kelas X-1)", email },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body?.data.admin.isPrimary, false);
  assert.equal(res.body?.data.admin.mustChangePassword, true);
  const temporary = res.body?.data.temporaryPassword ?? "";
  assert.ok(temporary.length >= 10, "kata sandi sementara dikembalikan sekali");

  const session = await loginOk(email, { password: temporary });
  assert.equal(session.mustChangePassword, true);
  assert.equal(session.user.schoolId, school.id);
  const audit = await prisma.auditLog.findFirst({ where: { action: "user.create", entityId: res.body?.data.admin.id } });
  assert.equal(audit?.schoolId, school.id, "tampil di Riwayat aktivitas sekolah");
});

test("admin tambahan hanya melihat daftar (403 PRIMARY_ADMIN_ONLY untuk kelola); super admin wajib ?schoolId=", async () => {
  const { school, primary } = await schoolWithPrimary();
  const helper = await createSchoolAdmin(school.id);
  const helperToken = (await createSessionToken(helper.id, { platform: "WEB", deviceId: null })).token;

  const list = await call<AdminBody[]>(listRoute as AnyRouteHandler, "GET", "", helperToken);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body?.data.map((a) => [a.id, a.isPrimary]), [[primary.id, true], [helper.id, false]], "admin utama di urutan pertama");
  const denied = await call(createRoute as AnyRouteHandler, "POST", "", helperToken, { json: { name: "Pak Budi", email: uniqEmail("guru") } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body?.error?.code, "PRIMARY_ADMIN_ONLY");
  const permissions = (await me(helperToken)).body?.data.permissions ?? [];
  assert.ok(permissions.includes("schoolAdmins.read"));
  assert.ok(!permissions.includes("schoolAdmins.manage"), "tombol kelola tidak tampil untuk admin tambahan");

  const sa = (await createSessionToken((await createSuperAdmin()).id, { platform: "WEB", deviceId: null })).token;
  const missing = await call(createRoute as AnyRouteHandler, "POST", "", sa, { json: { name: "Pak Budi", email: uniqEmail("guru") } });
  assert.equal(missing.body?.error?.code, "SCHOOL_ID_REQUIRED");
  const viaPlatform = await call<{ admin: AdminBody }>(createRoute as AnyRouteHandler, "POST", `?schoolId=${school.id}`, sa, {
    json: { name: "Pak Budi", email: uniqEmail("guru") },
  });
  assert.equal(viaPlatform.status, 201);
  const bare = await createSchool();
  const noPrimary = await call(createRoute as AnyRouteHandler, "POST", `?schoolId=${bare.id}`, sa, { json: { name: "Pak Budi", email: uniqEmail("guru") } });
  assert.equal(noPrimary.body?.error?.code, "PRIMARY_ADMIN_MISSING", "admin utama tidak pernah lahir dari endpoint admin tambahan");
});

test("cakupan: admin sekolah lain & siswa -> 404; admin utama dilindungi -> 403 PRIMARY_ADMIN_PROTECTED", async () => {
  const { school, primary, token } = await schoolWithPrimary();
  const other = await createSchool();
  const foreign = await createSchoolAdmin(other.id);
  const student = await createStudent(school.id);
  const rename = (id: string) => call(updateRoute as AnyRouteHandler, "PATCH", `/${id}`, token, { id, json: { name: "Nama Baru" } });

  assert.equal((await rename(foreign.id)).status, 404);
  assert.equal((await rename(student.user.id)).status, 404);
  assert.equal((await call(getRoute as AnyRouteHandler, "GET", `/${foreign.id}`, token, { id: foreign.id })).status, 404);
  const protectedRes = await rename(primary.id);
  assert.equal(protectedRes.status, 403);
  assert.equal(protectedRes.body?.error?.code, "PRIMARY_ADMIN_PROTECTED");
  const reset = await call(resetRoute as AnyRouteHandler, "POST", `/${primary.id}/reset-password`, token, { id: primary.id, json: {} });
  assert.equal(reset.body?.error?.code, "PRIMARY_ADMIN_PROTECTED");
});

test("kelola akun guru: ubah, nonaktifkan (sesi dicabut), aktifkan, reset sandi, cabut sesi; email bentrok 409", async () => {
  const { school, token } = await schoolWithPrimary();
  const teacher = await createSchoolAdmin(school.id);
  const teacherToken = (await createSessionToken(teacher.id, { platform: "WEB", deviceId: null })).token;
  const id = teacher.id;

  const renamed = await call<AdminBody>(updateRoute as AnyRouteHandler, "PATCH", `/${id}`, token, { id, json: { name: "Pak Andi (Guru Matematika)" } });
  assert.equal(renamed.body?.data.name, "Pak Andi (Guru Matematika)");
  const taken = await call(updateRoute as AnyRouteHandler, "PATCH", `/${id}`, token, { id, json: { email: (await createSchoolAdmin(school.id)).email } });
  assert.equal(taken.body?.error?.code, "EMAIL_TAKEN");

  const off = await call<{ isActive: boolean; revokedSessions: number }>(deactivateRoute as AnyRouteHandler, "POST", `/${id}/deactivate`, token, {
    id,
    json: { reason: "Pindah tugas" },
  });
  assert.deepEqual([off.status, off.body?.data.isActive, off.body?.data.revokedSessions], [200, false, 1]);
  assert.equal((await me(teacherToken)).status, 401, "sesi guru langsung tidak berlaku");
  assert.equal((await call(activateRoute as AnyRouteHandler, "POST", `/${id}/activate`, token, { id })).status, 200);

  const reset = await call<{ temporaryPassword?: string }>(resetRoute as AnyRouteHandler, "POST", `/${id}/reset-password`, token, { id, json: {} });
  assert.ok(reset.body?.data.temporaryPassword);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id } })).mustChangePassword, true);
  const revoke = await call<{ revokedCount: number }>(revokeRoute as AnyRouteHandler, "POST", `/${id}/revoke-sessions`, token, { id });
  assert.equal(revoke.status, 200);
  const detail = await call<AdminBody>(getRoute as AnyRouteHandler, "GET", `/${id}`, token, { id });
  assert.deepEqual([detail.body?.data.isActive, detail.body?.data.isPrimary], [true, false]);
});
