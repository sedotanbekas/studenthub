/**
 * Peran akses RBAC (permintaan pemilik 2026-10-07): peran sistem tercentang sesuai hak lama, peran buatan
 * mempersempit hak secara seketika, pemasangan ke akun, admin utama memasang peran ke guru, anti terkunci sendiri.
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listRoute, POST as createRoute } from "@/app/api/v1/access-roles/route";
import { GET as catalogRoute } from "@/app/api/v1/access-roles/catalog/route";
import { DELETE as deleteRoute, GET as getRoute, PATCH as updateRoute } from "@/app/api/v1/access-roles/[id]/route";
import { PUT as assignUserRoute } from "@/app/api/v1/platform/users/[id]/access-role/route";
import { PUT as assignAdminRoute } from "@/app/api/v1/school/admins/[id]/access-role/route";
import { GET as listStudentsRoute } from "@/app/api/v1/school/students/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { actionsForBase } from "@/lib/roles/rules";
import { invalidateSystemRoles } from "@/lib/roles/system-roles";
import { me } from "../auth/helpers";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, createSuperAdmin } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope, type HttpMethod } from "../helpers/request";

beforeEach(() => { resetAllLimiters(); invalidateSystemRoles(); });
after(disconnect);

interface RoleBody { id: string; key: string; name: string; baseRole: string; isSystem: boolean; permissions: string[]; lockedPermissions: string[]; userCount: number; members?: { id: string }[] }

const web = async (userId: string) => (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;

function call<T>(handler: unknown, method: HttpMethod, url: string, bearer: string, extra: { id?: string; json?: unknown } = {}) {
  return callRoute<Envelope<T>>(handler as AnyRouteHandler, { method, url, bearer, ...(extra.id ? { params: { id: extra.id } } : {}), ...(extra.json !== undefined ? { json: extra.json } : {}) });
}

async function superToken() {
  return web((await createSuperAdmin()).id);
}

test("peran sistem dari migrasi: lima jenis akun (+ Admin Pemda), centang = hak bawaan POLICY", async () => {
  const token = await superToken();
  const res = await call<RoleBody[]>(listRoute, "GET", "/api/v1/access-roles", token);
  assert.equal(res.status, 200);
  const system = (res.body?.data ?? []).filter(r => r.isSystem);
  assert.deepEqual(system.map(r => r.key).sort(), ["admin-sekolah", "pemda", "siswa", "sponsor", "super-admin"]);
  for (const base of ["SCHOOL_ADMIN", "REGION_ADMIN"] as const) {
    const role = system.find(r => r.baseRole === base)!;
    assert.deepEqual([...role.permissions].sort(), actionsForBase(base).sort(), base);
  }
  const catalog = await call<{ group: string; items: { action: string }[] }[]>(catalogRoute, "GET", "/api/v1/access-roles/catalog", token);
  assert.ok((catalog.body?.data ?? []).some(g => g.items.some(i => i.action === "roles.manage")));
});

test("peran buatan mempersempit hak seketika; dicabut -> kembali ke peran sistem", async () => {
  const token = await superToken();
  const school = await createSchool();
  const guru = await createSchoolAdmin(school.id);
  const created = await call<RoleBody>(createRoute, "POST", "/api/v1/access-roles", token, { json: { name: "Guru piket", baseRole: "SCHOOL_ADMIN", permissions: ["attendance.monitor"] } });
  assert.equal(created.status, 201);
  const role = created.body!.data;
  assert.equal(role.key, "guru-piket");
  assert.ok(role.permissions.includes("auth.self"), "hak terkunci ikut");

  const assign = await call(assignUserRoute, "PUT", `/api/v1/platform/users/${guru.id}/access-role`, token, { id: guru.id, json: { accessRoleId: role.id } });
  assert.equal(assign.status, 200);
  const guruToken = await web(guru.id);
  const perms = (await me(guruToken)).body?.data.permissions ?? [];
  assert.ok(perms.includes("attendance.monitor") && !perms.includes("students.read"));
  const blocked = await call(listStudentsRoute, "GET", "/api/v1/school/students", guruToken);
  assert.equal(blocked.status, 403);

  // Centang ditambah -> berlaku di request berikutnya tanpa login ulang.
  const update = await call<RoleBody>(updateRoute, "PATCH", `/api/v1/access-roles/${role.id}`, token, { id: role.id, json: { permissions: ["attendance.monitor", "students.read"] } });
  assert.equal(update.status, 200);
  assert.equal((await call(listStudentsRoute, "GET", "/api/v1/school/students", guruToken)).status, 200);

  const removed = await call<{ usersReset: number }>(deleteRoute, "DELETE", `/api/v1/access-roles/${role.id}`, token, { id: role.id });
  assert.equal(removed.body?.data.usersReset, 1);
  assert.equal((await prisma.user.findUnique({ where: { id: guru.id } }))?.accessRoleId, null);
  assert.ok(((await me(guruToken)).body?.data.permissions ?? []).includes("billing.write"), "kembali ke hak peran sistem");
  const audits = await prisma.auditLog.count({ where: { entityId: role.id, action: { in: ["role.create", "role.update", "role.delete"] } } });
  assert.equal(audits, 3);
});

test("validasi: jenis akun tidak cocok, aksi asing, peran sistem tidak bisa dihapus", async () => {
  const token = await superToken();
  const school = await createSchool();
  const { user: studentUser } = await createStudent(school.id);
  const roles = (await call<RoleBody[]>(listRoute, "GET", "/api/v1/access-roles?baseRole=SCHOOL_ADMIN", token, {})).body?.data ?? [];
  const adminSystem = roles.find(r => r.isSystem)!;
  const mismatch = await call(assignUserRoute, "PUT", `/api/v1/platform/users/${studentUser.id}/access-role`, token, { id: studentUser.id, json: { accessRoleId: adminSystem.id } });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body?.error?.code, "ROLE_BASE_MISMATCH");
  const foreign = await call(createRoute, "POST", "/api/v1/access-roles", token, { json: { name: "Siswa aneh", baseRole: "STUDENT", permissions: ["schools.manage"] } });
  assert.equal(foreign.body?.error?.code, "INVALID_PERMISSION");
  const del = await call(deleteRoute, "DELETE", `/api/v1/access-roles/${adminSystem.id}`, token, { id: adminSystem.id });
  assert.equal(del.body?.error?.code, "SYSTEM_ROLE_LOCKED");
});

test("anti terkunci sendiri: hak kelola peran super admin sistem terkunci, peran sendiri tidak boleh kehilangan roles.manage", async () => {
  const sa = await createSuperAdmin();
  const token = await web(sa.id);
  const created = await call<RoleBody>(createRoute, "POST", "/api/v1/access-roles", token, { json: { name: "Admin platform terbatas", baseRole: "SUPER_ADMIN", permissions: ["roles.read", "roles.manage", "schools.manage"] } });
  const role = created.body!.data;
  await call(assignUserRoute, "PUT", `/api/v1/platform/users/${sa.id}/access-role`, token, { id: sa.id, json: { accessRoleId: role.id } });
  const lockout = await call(updateRoute, "PATCH", `/api/v1/access-roles/${role.id}`, token, { id: role.id, json: { permissions: ["schools.manage"] } });
  assert.equal(lockout.body?.error?.code, "ROLE_SELF_LOCKOUT");
  const inUse = await call(deleteRoute, "DELETE", `/api/v1/access-roles/${role.id}`, token, { id: role.id });
  assert.equal(inUse.body?.error?.code, "ROLE_IN_USE_BY_YOU");
  const system = ((await call<RoleBody[]>(listRoute, "GET", "/api/v1/access-roles?baseRole=SUPER_ADMIN", token)).body?.data ?? []).find(r => r.isSystem)!;
  assert.ok(system.lockedPermissions.includes("roles.manage"));
  await call(assignUserRoute, "PUT", `/api/v1/platform/users/${sa.id}/access-role`, token, { id: sa.id, json: { accessRoleId: null } });
  assert.equal((await call(deleteRoute, "DELETE", `/api/v1/access-roles/${role.id}`, token, { id: role.id })).status, 200);
});

test("admin utama memasang peran guru di sekolahnya; admin sekolah hanya melihat peran admin sekolah", async () => {
  const saToken = await superToken();
  const school = await createSchool();
  const primary = await createSchoolAdmin(school.id);
  await prisma.user.update({ where: { id: primary.id }, data: { primarySchoolId: school.id } });
  const guru = await createSchoolAdmin(school.id);
  const role = (await call<RoleBody>(createRoute, "POST", "/api/v1/access-roles", saToken, { json: { name: "Wali kelas", baseRole: "SCHOOL_ADMIN", permissions: ["students.read", "reportCards.read"] } })).body!.data;
  const primaryToken = await web(primary.id);
  const visible = (await call<RoleBody[]>(listRoute, "GET", "/api/v1/access-roles", primaryToken)).body?.data ?? [];
  assert.ok(visible.length > 0 && visible.every(r => r.baseRole === "SCHOOL_ADMIN"));
  const ok = await call(assignAdminRoute, "PUT", `/api/v1/school/admins/${guru.id}/access-role`, primaryToken, { id: guru.id, json: { accessRoleId: role.id } });
  assert.equal(ok.status, 200);
  const self = await call(assignAdminRoute, "PUT", `/api/v1/school/admins/${primary.id}/access-role`, primaryToken, { id: primary.id, json: { accessRoleId: role.id } });
  assert.equal(self.body?.error?.code, "PRIMARY_ADMIN_PROTECTED");
  const manage = await call(createRoute, "POST", "/api/v1/access-roles", primaryToken, { json: { name: "Coba", baseRole: "SCHOOL_ADMIN" } });
  assert.equal(manage.status, 403);
  const detail = await call<RoleBody>(getRoute, "GET", `/api/v1/access-roles/${role.id}`, primaryToken, { id: role.id });
  assert.deepEqual(detail.body?.data.members?.map(m => m.id), [guru.id]);
  await call(deleteRoute, "DELETE", `/api/v1/access-roles/${role.id}`, saToken, { id: role.id });
});
