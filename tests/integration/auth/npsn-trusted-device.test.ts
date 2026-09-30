/**
 * Login admin utama sekolah dengan NPSN + "Ingat perangkat ini" (30 hari) untuk super admin ber-TOTP,
 * dan aturan pembuatan admin (admin sekolah pertama = admin utama; admin tambahan wajib email).
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { POST as logoutAllRoute } from "@/app/api/v1/auth/logout-all/route";
import { PUT as loginEmailRoute } from "@/app/api/v1/me/email/route";
import { POST as createUserRoute } from "@/app/api/v1/platform/users/route";
import { totpCodeAt, totpStep } from "@/lib/auth/totp-rules";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSuperAdmin, DEFAULT_TEST_PASSWORD, hashTestPassword, TEST_TOTP_SECRET, uniqEmail } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { login, loginOk, loginRaw, uniqIp } from "./helpers";

beforeEach(resetAllLimiters);
after(disconnect);

const uniqNpsn = (): string => String(randomInt(10_000_000, 100_000_000));

async function primaryAdmin(npsn: string) {
  const school = await createSchool({ data: { npsn } });
  const user = await prisma.user.create({
    data: { role: "SCHOOL_ADMIN", name: "Admin Utama", passwordHash: await hashTestPassword(), schoolId: school.id, primarySchoolId: school.id },
  });
  return { school, user };
}

test("admin utama masuk dengan NPSN tanpa email, lalu menambah email login sendiri", async () => {
  const npsn = uniqNpsn();
  const { user } = await primaryAdmin(npsn);
  const tokens = await loginOk(npsn);
  assert.equal(tokens.user.id, user.id);
  await prisma.user.update({ where: { id: user.id }, data: { mustChangePassword: false } });
  const email = uniqEmail("npsn");
  const wrong = await callRoute<Envelope>(loginEmailRoute, { method: "PUT", url: "/api/v1/me/email", bearer: tokens.accessToken, json: { email, currentPassword: "Salah12345" } });
  assert.equal(wrong.body?.error?.code, "CURRENT_PASSWORD_INVALID");
  const saved = await callRoute<Envelope<{ email: string }>>(loginEmailRoute, { method: "PUT", url: "/api/v1/me/email", bearer: tokens.accessToken, json: { email, currentPassword: DEFAULT_TEST_PASSWORD } });
  assert.equal(saved.status, 200);
  assert.equal((await loginOk(email)).user.id, user.id);
  assert.equal((await loginOk(npsn)).user.id, user.id, "NPSN tetap berlaku");
});

test("NPSN sekolah tanpa admin utama -> 401 seragam", async () => {
  const school = await createSchool({ data: { npsn: uniqNpsn() } });
  const res = await login(school.npsn ?? "");
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "INVALID_CREDENTIALS");
});

test("ingat perangkat: tanpa TOTP selama token berlaku; akun lain & logout semua perangkat -> TOTP lagi", async () => {
  const sa = await createSuperAdmin();
  const email = sa.email ?? "";
  const code = totpCodeAt(TEST_TOTP_SECRET, totpStep(new Date()));
  const base = { identifier: email, password: DEFAULT_TEST_PASSWORD, platform: "WEB" };
  const first = await loginRaw({ ...base, totpCode: code, rememberDevice: true }, { "x-real-ip": uniqIp() });
  assert.equal(first.status, 200);
  const trusted = (first.body?.data as { trustedDevice?: { token: string } } | undefined)?.trustedDevice?.token;
  assert.ok(trusted, "token perangkat tepercaya terbit");
  const again = await loginRaw({ ...base, trustedDeviceToken: trusted }, { "x-real-ip": uniqIp() });
  assert.equal(again.status, 200, JSON.stringify(again.body?.error));
  assert.equal((await login(email)).body?.error?.code, "TOTP_REQUIRED", "tanpa token tetap wajib TOTP");
  const other = await createSuperAdmin();
  const foreign = await loginRaw({ ...base, identifier: other.email, trustedDeviceToken: trusted }, { "x-real-ip": uniqIp() });
  assert.equal(foreign.body?.error?.code, "TOTP_REQUIRED", "token milik akun lain tidak berlaku");
  await callRoute(logoutAllRoute, { method: "POST", url: "/api/v1/auth/logout-all", bearer: again.body?.data.accessToken });
  const revoked = await loginRaw({ ...base, trustedDeviceToken: trusted }, { "x-real-ip": uniqIp() });
  assert.equal(revoked.body?.error?.code, "TOTP_REQUIRED", "logout semua perangkat melupakan perangkat tepercaya");
});

test("buat admin: pertama tanpa email = admin utama; tambahan tanpa email -> 422 EMAIL_REQUIRED", async () => {
  const sa = await createSuperAdmin();
  const { token } = await createSessionToken(sa.id, { platform: "WEB", deviceId: null });
  const school = await createSchool({ data: { npsn: uniqNpsn() } });
  const create = (json: unknown) => callRoute<Envelope<{ user: { id: string; loginNpsn: string | null } }>>(createUserRoute, { method: "POST", url: "/api/v1/platform/users", bearer: token, json });
  const first = await create({ role: "SCHOOL_ADMIN", name: "Admin Utama", schoolId: school.id });
  assert.equal(first.status, 201, JSON.stringify(first.body?.error));
  assert.equal(first.body?.data.user.loginNpsn, school.npsn);
  const second = await create({ role: "SCHOOL_ADMIN", name: "Admin Kedua", schoolId: school.id });
  assert.equal(second.body?.error?.code, "EMAIL_REQUIRED");
  const withEmail = await create({ role: "SCHOOL_ADMIN", name: "Admin Kedua", schoolId: school.id, email: uniqEmail("adm2") });
  assert.equal(withEmail.status, 201);
  assert.equal(withEmail.body?.data.user.loginNpsn, null);
  const noNpsn = await createSchool();
  assert.equal((await create({ role: "SCHOOL_ADMIN", name: "Admin", schoolId: noNpsn.id })).body?.error?.code, "SCHOOL_NPSN_REQUIRED");
});
