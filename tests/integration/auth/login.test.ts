import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../helpers/db";
import {
  createSchool,
  createSchoolAdmin,
  createSponsor,
  createStudent,
  createSuperAdmin,
  uniqEmail,
  uniqNisn,
} from "../helpers/factories";
import { login, loginOk, loginRaw, me, uniqDeviceId, uniqIp, uniqPushToken } from "./helpers";

let schoolId = "";

before(async () => {
  resetAllLimiters();
  schoolId = (await createSchool()).id;
});
after(disconnect);

test("login NISN dari ANDROID -> token, sesi mobile, perangkat terikat, lastLoginAt", async () => {
  const { user, student } = await createStudent(schoolId);
  const deviceId = uniqDeviceId();
  const res = await login(student.nisn, { platform: "ANDROID", deviceId, deviceName: "HP Uji", ip: "10.1.2.3", userAgent: "Expo/1" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const data = res.body?.data;
  assert.ok(data?.accessToken && data.refreshToken && data.sessionId);
  assert.deepEqual(data.user, { id: user.id, name: user.name, role: "STUDENT", schoolId, sponsorId: null });
  assert.equal(data.mustChangePassword, false);
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: data.sessionId } });
  assert.equal(session.platform, "ANDROID");
  assert.equal(session.deviceId, deviceId);
  assert.equal(session.deviceName, "HP Uji");
  assert.equal(session.ipAddress, "10.1.2.3");
  assert.equal(session.userAgent, "Expo/1");
  const days = (session.expiresAt.getTime() - session.createdAt.getTime()) / 86_400_000;
  assert.ok(days > 179.9 && days < 180.1, `umur sesi ${days}`);
  const token = await prisma.refreshToken.findFirstOrThrow({ where: { sessionId: data.sessionId } });
  assert.match(token.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(token.tokenHash, data.refreshToken);
  const refreshed = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { boundDeviceId: true, deviceBoundAt: true } });
  assert.equal(refreshed.boundDeviceId, deviceId);
  assert.ok(refreshed.deviceBoundAt);
  assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastLoginAt);
  assert.equal((await me(data.accessToken)).status, 200);
});

test("login email tidak peka huruf besar; sesi WEB 7 hari dan refresh 12 jam", async () => {
  const email = uniqEmail("Adm");
  const admin = await createSchoolAdmin(schoolId, { email });
  const data = await loginOk(email.toUpperCase());
  assert.equal(data.user.id, admin.id);
  assert.equal(data.user.role, "SCHOOL_ADMIN");
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: data.sessionId } });
  assert.equal(session.platform, "WEB");
  assert.equal(session.deviceId, null);
  const refreshHours = (Date.parse(data.refreshTokenExpiresAt) - session.createdAt.getTime()) / 3_600_000;
  assert.ok(refreshHours > 11.9 && refreshHours < 12.1, `umur refresh ${refreshHours}`);
});

test("kredensial salah / akun tidak ada -> 401 INVALID_CREDENTIALS seragam, dipadatkan >= 300 ms", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const cases = [
    { identifier: admin.email ?? "", password: "SalahSekali1" },
    { identifier: uniqEmail("tidakada"), password: "SalahSekali1" },
    { identifier: uniqNisn(), password: "SalahSekali1" },
  ];
  for (const c of cases) {
    const started = performance.now();
    const res = await login(c.identifier, { password: c.password });
    const elapsed = performance.now() - started;
    assert.equal(res.status, 401);
    assert.equal(res.body?.error?.code, "INVALID_CREDENTIALS");
    assert.equal(res.body?.error?.message, "NISN/email atau kata sandi salah.");
    assert.ok(elapsed >= 295, `respons gagal terlalu cepat: ${elapsed} ms`);
  }
});

test("siswa DRAFT (belum punya activeNisn) tidak bisa login -> 401", async () => {
  const { student } = await createStudent(schoolId, { status: "DRAFT" });
  const res = await login(student.nisn, { platform: "WEB" });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "INVALID_CREDENTIALS");
});

test("validasi bentuk -> 400 VALIDATION_FAILED", async () => {
  const bad = [
    { identifier: "abc", password: "x", platform: "WEB" },
    { identifier: "123456789", password: "x", platform: "WEB" },
    { identifier: "a@b.id", password: "x", platform: "DESKTOP" },
    { identifier: "a@b.id", password: "", platform: "WEB" },
    { identifier: "a@b.id", password: "x", platform: "WEB", role: "SUPER_ADMIN" },
    { identifier: "a@b.id", password: "x", platform: "ANDROID", deviceId: "pendek" },
    { identifier: "a@b.id", password: "x", platform: "ANDROID", deviceId: "device-0001", expoPushToken: "bukan-token" },
  ];
  for (const json of bad) {
    const res = await loginRaw(json, { "x-real-ip": uniqIp() });
    assert.equal(res.status, 400, JSON.stringify(json));
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
});

test("siswa di ANDROID/IOS tanpa deviceId -> 400 DEVICE_ID_REQUIRED; di WEB boleh", async () => {
  const { student } = await createStudent(schoolId);
  const res = await loginRaw({ identifier: student.nisn, password: "Rahasia123", platform: "IOS" }, { "x-real-ip": uniqIp() });
  assert.equal(res.status, 400);
  assert.equal(res.body?.error?.code, "DEVICE_ID_REQUIRED");
  assert.equal((await login(student.nisn, { platform: "WEB" })).status, 200);
});

test("token push pada login WEB -> 422 PUSH_TOKEN_WEB_SESSION", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const res = await login(admin.email ?? "", { platform: "WEB", expoPushToken: uniqPushToken() });
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "PUSH_TOKEN_WEB_SESSION");
});

test("akun tidak layak -> 403 ACCOUNT_INACTIVE dengan alasan (hanya setelah password benar)", async () => {
  const inactiveAdmin = await createSchoolAdmin(schoolId, { isActive: false });
  const inactiveStudent = await createStudent(schoolId, { status: "INACTIVE" });
  const closedSchool = await createSchool({ data: { isActive: false } });
  const closedAdmin = await createSchoolAdmin(closedSchool.id);
  const cases = [
    { identifier: inactiveAdmin.email ?? "", reason: "USER_INACTIVE" },
    { identifier: inactiveStudent.student.nisn, reason: "STUDENT_INACTIVE" },
    { identifier: closedAdmin.email ?? "", reason: "SCHOOL_INACTIVE" },
  ];
  for (const c of cases) {
    const res = await login(c.identifier);
    assert.equal(res.status, 403, c.reason);
    assert.equal(res.body?.error?.code, "ACCOUNT_INACTIVE");
    assert.deepEqual(res.body?.error?.details, { reason: c.reason });
    const wrong = await login(c.identifier, { password: "SalahSekali1" });
    assert.equal(wrong.status, 401, "password salah tetap 401 (tidak membocorkan status akun)");
  }
});

test("siswa LULUS (read-only) dan sponsor SUSPENDED tetap bisa login", async () => {
  const graduated = await createStudent(schoolId, { status: "GRADUATED" });
  assert.equal((await login(graduated.student.nisn)).status, 200);
  const { user } = await createSponsor({ status: "SUSPENDED" });
  const data = await loginOk(user.email ?? "");
  assert.equal(data.user.role, "SPONSOR");
  assert.equal((await me(data.accessToken)).status, 200);
});

test("kata sandi sementara kedaluwarsa -> 403 TEMP_PASSWORD_EXPIRED; belum kedaluwarsa -> mustChangePassword", async () => {
  const expired = await createSchoolAdmin(schoolId, { mustChangePassword: true });
  await prisma.user.update({ where: { id: expired.id }, data: { tempPasswordExpiresAt: new Date(Date.now() - 60_000) } });
  const res = await login(expired.email ?? "");
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "TEMP_PASSWORD_EXPIRED");
  const fresh = await createSchoolAdmin(schoolId, { mustChangePassword: true });
  await prisma.user.update({ where: { id: fresh.id }, data: { tempPasswordExpiresAt: new Date(Date.now() + 86_400_000) } });
  assert.equal((await loginOk(fresh.email ?? "")).mustChangePassword, true);
});

test("login HP kedua siswa mencabut sesi HP pertama (satu sesi mobile per siswa)", async () => {
  const { student } = await createStudent(schoolId);
  const pushToken = uniqPushToken();
  const first = await loginOk(student.nisn, { platform: "ANDROID", expoPushToken: pushToken });
  const secondDevice = uniqDeviceId();
  const second = await loginOk(student.nisn, { platform: "IOS", deviceId: secondDevice });
  const old = await prisma.authSession.findUniqueOrThrow({ where: { id: first.sessionId } });
  assert.ok(old.revokedAt);
  assert.equal(old.revokeReason, "REPLACED");
  assert.equal(old.expoPushToken, null);
  const stale = await me(first.accessToken);
  assert.equal(stale.status, 401);
  assert.equal(stale.body?.error?.code, "SESSION_INVALID");
  assert.equal((await me(second.accessToken)).status, 200);
  const bound = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { boundDeviceId: true } });
  assert.equal(bound.boundDeviceId, secondDevice);
});

test("login HP paralel siswa yang sama -> tetap hanya satu sesi mobile hidup (kunci per user)", async () => {
  const { user, student } = await createStudent(schoolId);
  const results = await Promise.all([
    login(student.nisn, { platform: "ANDROID" }),
    login(student.nisn, { platform: "IOS" }),
    login(student.nisn, { platform: "ANDROID" }),
  ]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 1);
});

test("login di deviceId yang sama oleh user lain mencabut sesi user sebelumnya + token push-nya", async () => {
  const deviceId = uniqDeviceId();
  const a = await createSchoolAdmin(schoolId);
  const b = await createSchoolAdmin(schoolId);
  const first = await loginOk(a.email ?? "", { platform: "ANDROID", deviceId, expoPushToken: uniqPushToken() });
  const second = await loginOk(b.email ?? "", { platform: "ANDROID", deviceId });
  const old = await prisma.authSession.findUniqueOrThrow({ where: { id: first.sessionId } });
  assert.equal(old.revokeReason, "REPLACED");
  assert.equal(old.expoPushToken, null);
  assert.equal((await me(second.accessToken)).status, 200);
});

test("batas sesi per peran: super admin login ke-4 mengusir sesi tertua", async () => {
  const sa = await createSuperAdmin({ totp: false });
  const sessions: string[] = [];
  for (let i = 0; i < 4; i += 1) sessions.push((await loginOk(sa.email ?? "")).sessionId);
  const rows = await prisma.authSession.findMany({ where: { userId: sa.id }, select: { id: true, revokedAt: true, revokeReason: true } });
  const live = rows.filter((r) => r.revokedAt === null).map((r) => r.id);
  assert.equal(live.length, 3);
  assert.deepEqual([...live].sort(), sessions.slice(1).sort());
  assert.equal(rows.find((r) => r.id === sessions[0])?.revokeReason, "REPLACED");
});

test("expoPushToken saat login dipindah dari sesi lain yang memegangnya", async () => {
  const token = uniqPushToken();
  const a = await createSchoolAdmin(schoolId);
  const holder = await loginOk(a.email ?? "", { platform: "ANDROID", expoPushToken: token });
  const b = await createSchoolAdmin(schoolId);
  const taker = await loginOk(b.email ?? "", { platform: "IOS", expoPushToken: token });
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: holder.sessionId } })).expoPushToken, null);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: taker.sessionId } })).expoPushToken, token);
  assert.equal((await me(holder.accessToken)).status, 200, "sesi lama tetap hidup; hanya token push yang dipindah");
});

test("limiter pasangan IP+identifier: 8 gagal -> percobaan ke-9 429 + Retry-After (password benar pun)", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const ip = uniqIp();
  for (let i = 0; i < 8; i += 1) {
    assert.equal((await login(admin.email ?? "", { password: "SalahSekali1", ip })).status, 401);
  }
  const locked = await login(admin.email ?? "", { ip });
  assert.equal(locked.status, 429);
  assert.equal(locked.body?.error?.code, "RATE_LIMITED");
  assert.ok(Number(locked.headers.get("retry-after")) > 0);
  assert.equal((await login(admin.email ?? "", { ip: uniqIp() })).status, 200, "IP lain belum terkunci");
});

test("limiter identifier lintas IP: 10 gagal dari IP berbeda -> 429", async () => {
  const admin = await createSchoolAdmin(schoolId);
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await login(admin.email ?? "", { password: "SalahSekali1" })).status, 401);
  }
  const locked = await login(admin.email ?? "");
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers.get("retry-after")) > 0);
});

test("login berhasil mereset penghitung pasangan IP+identifier", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const ip = uniqIp();
  for (let i = 0; i < 7; i += 1) await login(admin.email ?? "", { password: "SalahSekali1", ip });
  assert.equal((await login(admin.email ?? "", { ip })).status, 200);
  assert.equal((await login(admin.email ?? "", { password: "SalahSekali1", ip })).status, 401, "hitungan mulai dari nol lagi");
});
