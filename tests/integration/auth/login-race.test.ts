import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { classifyIdentifier } from "@/lib/auth/identifier";
import { loginLimiterKeys } from "@/lib/auth/login-service";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { getLimiter, RATE_LIMITS, resetAllLimiters } from "@/lib/http/rate-limits";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey, lockRows } from "@/lib/tx";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent, hashTestPassword } from "../helpers/factories";
import { APP_LOCK_SQL, holdTransaction, login, USER_UPDATE_SQL, uniqIp, waitUntilBlocked } from "./helpers";

/**
 * Regresi login: (B) kredensial/kelayakan dibaca ulang di bawah kunci user sehingga perubahan kata sandi
 * atau penonaktifan yang terjadi saat login berjalan tidak meninggalkan sesi hidup; (C) slot limiter
 * dipesan sebelum lookup/bcrypt sehingga burst paralel tidak melewati batas, dan dikembalikan saat sukses.
 */
const WRONG_PASSWORD = "SalahSekali1";
const CHANGED_PASSWORD = "SandiBaru2026";

let schoolId = "";

before(async () => {
  resetAllLimiters();
  schoolId = (await createSchool()).id;
});
after(disconnect);

const liveSessions = (userId: string) => prisma.authSession.count({ where: { userId, revokedAt: null } });

test("kata sandi diganti (kunci user) saat login dengan sandi lama berjalan -> 401, tanpa sesi tersisa", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const newHash = await hashTestPassword(CHANGED_PASSWORD);
  const change = holdTransaction(async (tx) => {
    await lockKey(tx, userLockKey(admin.id));
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash: newHash } });
    await revokeAllSessions(tx, admin.id, "PASSWORD_CHANGED", new Date());
  });
  await change.ready;
  const pending = login(admin.email ?? "");
  const state = await waitUntilBlocked(pending, [APP_LOCK_SQL]);
  await change.commit();
  const res = await pending;
  assert.equal(state, "blocked");
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "INVALID_CREDENTIALS");
  assert.equal(await liveSessions(admin.id), 0);
});

test("hash diubah penulis tanpa kunci user saat login berjalan -> 401 lewat compare-and-set, tanpa sesi tersisa", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const newHash = await hashTestPassword(CHANGED_PASSWORD);
  const reset = holdTransaction(
    async (tx) => {
      await tx.user.update({ where: { id: admin.id }, data: { passwordHash: newHash, mustChangePassword: true } });
    },
    async (tx) => {
      await revokeAllSessions(tx, admin.id, "ADMIN_REVOKED", new Date());
    },
  );
  await reset.ready;
  const pending = login(admin.email ?? "");
  const state = await waitUntilBlocked(pending, [USER_UPDATE_SQL]);
  await reset.commit();
  const res = await pending;
  assert.equal(state, "blocked");
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "INVALID_CREDENTIALS");
  assert.equal(await liveSessions(admin.id), 0);
});

test("reset siswa (kunci baris Student) saat login HP siswa berjalan -> 401, perangkat tidak terikat, tanpa sesi", async () => {
  const { user, student } = await createStudent(schoolId);
  const newHash = await hashTestPassword(CHANGED_PASSWORD);
  const reset = holdTransaction(
    async (tx) => {
      await lockRows(tx, "Student", [student.id]);
      await tx.user.update({ where: { id: user.id }, data: { passwordHash: newHash, mustChangePassword: true } });
    },
    async (tx) => {
      await revokeAllSessions(tx, user.id, "ADMIN_REVOKED", new Date());
    },
  );
  await reset.ready;
  const pending = login(student.nisn, { platform: "ANDROID" });
  const state = await waitUntilBlocked(pending, ["UPDATE `Student`", USER_UPDATE_SQL]);
  await reset.commit();
  const res = await pending;
  assert.equal(state, "blocked");
  assert.equal(res.status, 401);
  assert.equal(await liveSessions(user.id), 0);
  const bound = await prisma.student.findUniqueOrThrow({ where: { id: student.id }, select: { boundDeviceId: true } });
  assert.equal(bound.boundDeviceId, null, "pengikatan perangkat ikut di-rollback");
});

test("akun dinonaktifkan saat login berjalan -> 403 ACCOUNT_INACTIVE, tanpa sesi tersisa", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const deactivate = holdTransaction(async (tx) => {
    await lockKey(tx, userLockKey(admin.id));
    await tx.user.update({ where: { id: admin.id }, data: { isActive: false } });
    await revokeAllSessions(tx, admin.id, "ACCOUNT_DISABLED", new Date());
  });
  await deactivate.ready;
  const pending = login(admin.email ?? "");
  const state = await waitUntilBlocked(pending, [APP_LOCK_SQL]);
  await deactivate.commit();
  const res = await pending;
  assert.equal(state, "blocked");
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "ACCOUNT_INACTIVE");
  assert.deepEqual(res.body?.error?.details, { reason: "USER_INACTIVE" });
  assert.equal(await liveSessions(admin.id), 0);
});

test("30 login salah paralel dari satu IP+identifier: hanya LOGIN_PAIR.limit yang diproses, sisanya 429", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const ip = uniqIp();
  const results = await Promise.all(Array.from({ length: 30 }, () => login(admin.email ?? "", { password: WRONG_PASSWORD, ip })));
  const statuses = results.map((res) => res.status);
  const processed = statuses.filter((status) => status === 401).length;
  assert.equal(processed, RATE_LIMITS.LOGIN_PAIR.limit, statuses.join(","));
  assert.equal(statuses.filter((status) => status === 429).length, 30 - processed);
});

test("burst login berhasil dari satu IP mengembalikan seluruh slot: IP tidak terkunci", async () => {
  const ip = uniqIp();
  const admins = await Promise.all(Array.from({ length: 20 }, () => createSchoolAdmin(schoolId)));
  const burst = await Promise.all(admins.map((admin) => login(admin.email ?? "", { ip })));
  assert.deepEqual(burst.map((res) => res.status), admins.map(() => 200));
  const ipKey = loginLimiterKeys(ip, classifyIdentifier(admins[0]?.email ?? "")).ip;
  // Sisa dua slot: bila burst di atas meninggalkan >= 2 slot, login berurutan berikut akan terkunci.
  for (let i = 0; i < RATE_LIMITS.LOGIN_IP.limit - 2; i += 1) getLimiter("LOGIN_IP").recordFailure(ipKey);
  for (const admin of admins.slice(0, 5)) assert.equal((await login(admin.email ?? "", { ip })).status, 200);
  assert.equal(getLimiter("LOGIN_IP").check(ipKey).ok, true);
});

test("login berhasil mengembalikan slot identifier: sisa dua slot tetap cukup untuk login berulang", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const idKey = loginLimiterKeys(null, classifyIdentifier(admin.email ?? "")).identifier;
  for (let i = 0; i < RATE_LIMITS.LOGIN_IDENTIFIER.limit - 2; i += 1) getLimiter("LOGIN_IDENTIFIER").recordFailure(idKey);
  for (let i = 0; i < 3; i += 1) assert.equal((await login(admin.email ?? "")).status, 200, `login ke-${i + 1}`);
  assert.equal(getLimiter("LOGIN_IDENTIFIER").check(idKey).ok, true);
});
