import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listUsersRoute, POST as createUserRoute } from "@/app/api/v1/platform/users/route";
import { GET as getUserRoute, PATCH as patchUserRoute } from "@/app/api/v1/platform/users/[id]/route";
import { GET as listProvinces } from "@/app/api/v1/regions/provinces/route";
import { TEMP_PASSWORD_TTL_MS, verifyPassword } from "@/lib/auth/password";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, uniqEmail } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { setupTwoSchools, type TwoSchools } from "../schools/fixtures";

type UserBody = {
  id: string;
  name: string;
  email: string | null;
  role: string;
  isActive: boolean;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: string | null;
  school: { id: string; name: string } | null;
  activeSessionCount?: number;
};

let fx: TwoSchools;

before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const create = (token: string, json: unknown) =>
  callRoute<Envelope<{ user: UserBody; temporaryPassword?: string }>>(createUserRoute, { method: "POST", url: "/api/v1/platform/users", bearer: token, json });
const detail = (token: string, id: string) =>
  callRoute<Envelope<UserBody>>(getUserRoute, { method: "GET", url: `/api/v1/platform/users/${id}`, bearer: token, params: { id } });
const patch = (token: string, id: string, json: unknown) =>
  callRoute<Envelope<UserBody>>(patchUserRoute, { method: "PATCH", url: `/api/v1/platform/users/${id}`, bearer: token, params: { id }, json });

async function storedHash(userId: string): Promise<string> {
  const row = await prisma.user.findUniqueOrThrow({ where: { id: userId }, omit: { passwordHash: false } });
  return row.passwordHash;
}

describe("POST /platform/users", () => {
  test("admin sekolah tanpa kata sandi: sementara 10 karakter, sekali tampil, kedaluwarsa 14 hari, audit tanpa rahasia", async () => {
    const email = uniqEmail("Adm").toUpperCase();
    const started = Date.now();
    const res = await create(fx.sa.token, { role: "SCHOOL_ADMIN", name: "Admin Baru", email, schoolId: fx.schoolA.id });
    assert.equal(res.status, 201);
    const { user, temporaryPassword } = res.body?.data ?? {};
    assert.ok(user && temporaryPassword);
    assert.equal(temporaryPassword.length, 10);
    assert.equal(user.email, email.toLowerCase());
    assert.equal(user.mustChangePassword, true);
    assert.equal(user.school?.id, fx.schoolA.id);
    const expires = Date.parse(user.tempPasswordExpiresAt ?? "");
    assert.ok(expires >= started + TEMP_PASSWORD_TTL_MS - 5_000 && expires <= Date.now() + TEMP_PASSWORD_TTL_MS);
    assert.equal(await verifyPassword(temporaryPassword, await storedHash(user.id)), true);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: "user.create" } });
    assert.equal(audit.schoolId, fx.schoolA.id);
    assert.equal((audit.after as { credential: string }).credential, "GENERATED");
    assert.doesNotMatch(JSON.stringify(audit.after), new RegExp(temporaryPassword));
  });

  test("super admin dengan kata sandi diketik: tanpa temporaryPassword & tanpa kedaluwarsa", async () => {
    const res = await create(fx.sa.token, { role: "SUPER_ADMIN", name: "Super Kedua", email: uniqEmail("sa2"), initialPassword: "KuatSekali99" });
    assert.equal(res.status, 201);
    assert.equal(res.body?.data.user.school, null);
    assert.equal(res.body?.data.user.tempPasswordExpiresAt, null);
    assert.equal("temporaryPassword" in (res.body?.data ?? {}), false);
    assert.equal(await verifyPassword("KuatSekali99", await storedHash(res.body?.data.user.id ?? "")), true);
  });

  test("kata sandi lemah -> 422 PASSWORD_POLICY", async () => {
    const res = await create(fx.sa.token, { role: "SUPER_ADMIN", name: "Super Lemah", email: uniqEmail("weak"), initialPassword: "password1" });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "PASSWORD_POLICY");
  });

  test("peran & sekolah: sponsor/siswa 400, schoolId wajib/terlarang 400, sekolah nonaktif 409, tak dikenal 404", async () => {
    const base = { name: "Pengguna Uji", email: uniqEmail("r") };
    assert.equal((await create(fx.sa.token, { ...base, role: "SPONSOR" })).body?.error?.code, "USE_DEDICATED_ENDPOINT");
    assert.equal((await create(fx.sa.token, { ...base, role: "STUDENT", schoolId: fx.schoolA.id })).body?.error?.code, "USE_DEDICATED_ENDPOINT");
    assert.equal((await create(fx.sa.token, { ...base, role: "SCHOOL_ADMIN" })).body?.error?.code, "SCHOOL_ID_REQUIRED");
    assert.equal((await create(fx.sa.token, { ...base, role: "SUPER_ADMIN", schoolId: fx.schoolA.id })).body?.error?.code, "SCHOOL_ID_NOT_ALLOWED");
    const inactive = await createSchool({ data: { isActive: false } });
    const res = await create(fx.sa.token, { ...base, role: "SCHOOL_ADMIN", schoolId: inactive.id });
    assert.equal(res.status, 409);
    assert.equal(res.body?.error?.code, "SCHOOL_INACTIVE");
    assert.equal((await create(fx.sa.token, { ...base, role: "SCHOOL_ADMIN", schoolId: "tidak-ada" })).status, 404);
    assert.equal(await prisma.user.count({ where: { email: base.email } }), 0);
  });

  test("email ganda (beda huruf besar/kecil) -> 409 EMAIL_TAKEN; email/kunci tidak valid -> 400", async () => {
    const existing = await createSchoolAdmin(fx.schoolA.id);
    const dup = await create(fx.sa.token, { role: "SUPER_ADMIN", name: "Ganda", email: (existing.email ?? "").toUpperCase() });
    assert.equal(dup.status, 409);
    assert.equal(dup.body?.error?.code, "EMAIL_TAKEN");
    assert.equal((await create(fx.sa.token, { role: "SUPER_ADMIN", name: "Salah", email: "bukan-email" })).status, 400);
    assert.equal((await create(fx.sa.token, { role: "SUPER_ADMIN", name: "Salah", email: uniqEmail("k"), isActive: false })).status, 400);
  });

  test("selain super admin -> 403", async () => {
    for (const token of [fx.adminA.token, fx.student.token, fx.sponsor.token]) {
      assert.equal((await create(token, { role: "SUPER_ADMIN", name: "Tidak Boleh", email: uniqEmail("x") })).status, 403);
    }
  });
});

describe("GET /platform/users & /platform/users/{id}", () => {
  test("cari nama/email dengan filter peran, sekolah, status + meta", async () => {
    const marker = uniq("cari");
    const school = await createSchool();
    await createSchoolAdmin(school.id, { name: `Admin ${marker}` });
    await createSchoolAdmin(school.id, { name: `Admin ${marker} Nonaktif`, isActive: false });
    const url = `/api/v1/platform/users?q=${encodeURIComponent(marker)}&role=SCHOOL_ADMIN&schoolId=${school.id}`;
    const all = await callRoute<Envelope<UserBody[]>>(listUsersRoute, { method: "GET", url, bearer: fx.sa.token });
    assert.equal(all.status, 200);
    assert.equal(all.body?.data.length, 2);
    assert.equal(all.body?.meta?.total, 2);
    const active = await callRoute<Envelope<UserBody[]>>(listUsersRoute, { method: "GET", url: `${url}&isActive=true`, bearer: fx.sa.token });
    assert.deepEqual(active.body?.data.map((u) => u.isActive), [true]);
    const byEmail = await callRoute<Envelope<UserBody[]>>(listUsersRoute, {
      method: "GET",
      url: `/api/v1/platform/users?q=${encodeURIComponent(fx.adminB.user.email ?? "")}`,
      bearer: fx.sa.token,
    });
    assert.deepEqual(byEmail.body?.data.map((u) => u.id), [fx.adminB.user.id]);
    assert.equal((await callRoute(listUsersRoute, { method: "GET", url: "/api/v1/platform/users?role=GURU", bearer: fx.sa.token })).status, 400);
    assert.equal((await callRoute(listUsersRoute, { method: "GET", url: "/api/v1/platform/users", bearer: fx.adminA.token })).status, 403);
  });

  test("detail dengan jumlah sesi aktif; id tak dikenal 404", async () => {
    const admin = await createSchoolAdmin(fx.schoolB.id);
    await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    const second = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    await prisma.authSession.update({ where: { id: second.sessionId }, data: { revokedAt: new Date(), revokeReason: "LOGOUT" } });
    const res = await detail(fx.sa.token, admin.id);
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.activeSessionCount, 1);
    assert.equal(res.body?.data.school?.id, fx.schoolB.id);
    assert.equal((await detail(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await detail(fx.adminB.token, admin.id)).status, 403);
  });
});

describe("PATCH /platform/users/{id}", () => {
  test("ubah nama & email + audit before/after", async () => {
    const admin = await createSchoolAdmin(fx.schoolA.id);
    const email = uniqEmail("baru");
    const res = await patch(fx.sa.token, admin.id, { name: "Nama Diperbarui", email: email.toUpperCase() });
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.name, "Nama Diperbarui");
    assert.equal(res.body?.data.email, email);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: admin.id, action: "user.update" } });
    assert.deepEqual(audit.before, { name: admin.name, email: admin.email });
    assert.deepEqual(audit.after, { name: "Nama Diperbarui", email });
  });

  test("email milik akun lain 409; siswa 400; body kosong/peran 400; id asing 404", async () => {
    const admin = await createSchoolAdmin(fx.schoolA.id);
    const taken = await patch(fx.sa.token, admin.id, { email: fx.adminB.user.email });
    assert.equal(taken.status, 409);
    assert.equal(taken.body?.error?.code, "EMAIL_TAKEN");
    assert.equal((await patch(fx.sa.token, fx.student.user.id, { name: "Siswa Baru" })).body?.error?.code, "USE_STUDENT_ENDPOINT");
    assert.equal((await patch(fx.sa.token, admin.id, {})).status, 400);
    assert.equal((await patch(fx.sa.token, admin.id, { role: "SUPER_ADMIN" })).status, 400);
    assert.equal((await patch(fx.sa.token, admin.id, { schoolId: fx.schoolB.id })).status, 400);
    assert.equal((await patch(fx.sa.token, "tidak-ada", { name: "Siapa Saja" })).status, 404);
    assert.equal((await patch(fx.adminA.token, admin.id, { name: "Tidak Boleh" })).status, 403);
  });

  test("tanpa perubahan nyata: tanpa audit", async () => {
    const admin = await createSchoolAdmin(fx.schoolA.id);
    const res = await patch(fx.sa.token, admin.id, { name: admin.name, email: admin.email });
    assert.equal(res.status, 200);
    assert.equal(await prisma.auditLog.count({ where: { entityId: admin.id } }), 0);
  });
});

describe("akun super admin baru dapat dipakai", () => {
  test("token super admin buatan endpoint diblokir sampai ganti kata sandi", async () => {
    const created = await create(fx.sa.token, { role: "SUPER_ADMIN", name: "Super Baru", email: uniqEmail("sab") });
    const id = created.body?.data.user.id ?? "";
    const { token } = await createSessionToken(id, { platform: "WEB", deviceId: null });
    const res = await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: token });
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
  });
});
