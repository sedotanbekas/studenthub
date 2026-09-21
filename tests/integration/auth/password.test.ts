import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as changePasswordRoute } from "@/app/api/v1/auth/change-password/route";
import { GET as listProvinces } from "@/app/api/v1/regions/provinces/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, DEFAULT_TEST_PASSWORD } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { login, loginOk, me } from "./helpers";

let schoolId = "";

before(async () => {
  resetAllLimiters();
  schoolId = (await createSchool()).id;
});
after(disconnect);

const changePassword = (bearer: string, json: unknown) =>
  callRoute<Envelope<{ changed: true; otherSessionsRevoked: number }>>(changePasswordRoute, {
    method: "POST",
    url: "/api/v1/auth/change-password",
    bearer,
    json,
  });

const provinces = (bearer: string) => callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer });

test("ganti kata sandi: sesi lain dicabut, sesi saat ini tetap, audit tercatat, kata sandi baru berlaku", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const current = await loginOk(admin.email ?? "");
  const other = await loginOk(admin.email ?? "", { platform: "ANDROID" });
  const res = await changePassword(current.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: "SandiBaru2026" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { changed: true, otherSessionsRevoked: 1 });
  assert.equal((await me(current.accessToken)).status, 200);
  assert.equal((await me(other.accessToken)).status, 401);
  const otherRow = await prisma.authSession.findUniqueOrThrow({ where: { id: other.sessionId } });
  assert.equal(otherRow.revokeReason, "PASSWORD_CHANGED");
  const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(user.mustChangePassword, false);
  assert.equal(user.tempPasswordExpiresAt, null);
  assert.ok(user.passwordChangedAt);
  const audit = await prisma.auditLog.findFirst({ where: { action: "auth.password_change", entityId: admin.id } });
  assert.ok(audit);
  assert.equal(audit.actorId, admin.id);
  assert.doesNotMatch(JSON.stringify(audit.after), /SandiBaru2026|Rahasia123/);
  assert.equal((await login(admin.email ?? "", { password: DEFAULT_TEST_PASSWORD })).status, 401);
  assert.equal((await login(admin.email ?? "", { password: "SandiBaru2026" })).status, 200);
});

test("kata sandi lama salah -> 400 CURRENT_PASSWORD_INVALID; ke-6 -> 429 + Retry-After", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  for (let i = 0; i < 5; i += 1) {
    const res = await changePassword(tokens.accessToken, { currentPassword: "SalahSekali1", newPassword: "SandiBaru2026" });
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.code, "CURRENT_PASSWORD_INVALID");
  }
  const limited = await changePassword(tokens.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: "SandiBaru2026" });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await me(tokens.accessToken)).status, 200, "400 tidak mengeluarkan pengguna");
});

test("kebijakan kata sandi -> 422 PASSWORD_POLICY dengan daftar pelanggaran", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  const cases: Array<[string, string]> = [
    ["pendek1", "TOO_SHORT"],
    ["hanyahurufsaja", "NEEDS_DIGIT"],
    ["1234567890123", "NEEDS_LETTER"],
    ["password123", "TOO_COMMON"],
  ];
  for (const [newPassword, violation] of cases) {
    const res = await changePassword(tokens.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword });
    assert.equal(res.status, 422, newPassword);
    assert.equal(res.body?.error?.code, "PASSWORD_POLICY");
    const details = res.body?.error?.details as { violations: string[]; messages: string[] };
    assert.ok(details.violations.includes(violation), `${newPassword}: ${details.violations.join(",")}`);
    assert.equal(details.messages.length, details.violations.length);
  }
});

test("kata sandi siswa tidak boleh memuat NISN; sama dengan lama -> 422 PASSWORD_REUSED", async () => {
  const { student } = await createStudent(schoolId);
  const tokens = await loginOk(student.nisn, { platform: "ANDROID" });
  const withNisn = await changePassword(tokens.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: `ab${student.nisn}` });
  assert.equal(withNisn.status, 422);
  assert.deepEqual((withNisn.body?.error?.details as { violations: string[] }).violations, ["CONTAINS_PERSONAL_DATA"]);
  const reused = await changePassword(tokens.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: DEFAULT_TEST_PASSWORD });
  assert.equal(reused.status, 422);
  assert.equal(reused.body?.error?.code, "PASSWORD_REUSED");
});

test("bentuk body salah -> 400", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  for (const json of [{}, { currentPassword: DEFAULT_TEST_PASSWORD }, { currentPassword: "a", newPassword: "b", extra: 1 }]) {
    assert.equal((await changePassword(tokens.accessToken, json)).status, 400, JSON.stringify(json));
  }
});

test("gerbang wajib ganti kata sandi: route lain 403 sampai diganti; /auth/me tetap boleh", async () => {
  const admin = await createSchoolAdmin(schoolId, { mustChangePassword: true });
  await prisma.user.update({ where: { id: admin.id }, data: { tempPasswordExpiresAt: new Date(Date.now() + 86_400_000) } });
  const tokens = await loginOk(admin.email ?? "");
  assert.equal(tokens.mustChangePassword, true);
  const blocked = await provinces(tokens.accessToken);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
  const profile = await me(tokens.accessToken);
  assert.equal(profile.status, 200);
  assert.equal(profile.body?.data.user.mustChangePassword, true);
  assert.ok(profile.body?.data.permissions.includes("auth.self"));
  assert.ok(!profile.body?.data.permissions.includes("region.read"), "aksi biasa tidak diizinkan selama wajib ganti");
  const changed = await changePassword(tokens.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: "SandiBaru2026" });
  assert.equal(changed.status, 200);
  assert.equal((await provinces(tokens.accessToken)).status, 200);
  const after = await me(tokens.accessToken);
  assert.equal(after.body?.data.user.mustChangePassword, false);
  assert.ok(after.body?.data.permissions.includes("region.read"));
});

test("alur siswa: login NISN wajib ganti kata sandi -> /auth/me -> ganti -> flag hilang", async () => {
  const { student } = await createStudent(schoolId, { mustChangePassword: true });
  const tokens = await loginOk(student.nisn, { platform: "ANDROID" });
  assert.equal(tokens.mustChangePassword, true);
  assert.equal((await me(tokens.accessToken)).body?.data.user.mustChangePassword, true);
  const res = await changePassword(tokens.accessToken, { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: "BelajarRajin7" });
  assert.equal(res.status, 200);
  assert.equal(res.body?.data.otherSessionsRevoked, 0);
  assert.equal((await me(tokens.accessToken)).body?.data.user.mustChangePassword, false);
});

test("akun dinonaktifkan -> panggilan berikutnya 401 ACCOUNT_INACTIVE", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
  const res = await me(tokens.accessToken);
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "ACCOUNT_INACTIVE");
});
