import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as changePasswordRoute } from "@/app/api/v1/auth/change-password/route";
import { POST as resetRoute } from "@/app/api/v1/platform/users/[id]/reset-password/route";
import { verifyPassword } from "@/lib/auth/password";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { userLockKey } from "@/lib/lock-keys";
import { lockKey } from "@/lib/tx";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSuperAdmin, DEFAULT_TEST_PASSWORD, hashTestPassword } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { actor, type Actor } from "../schools/fixtures";
import { APP_LOCK_SQL, holdTransaction, loginOk, USER_UPDATE_SQL, waitUntilBlocked } from "./helpers";

/**
 * Regresi balapan ganti kata sandi vs reset admin/penulis lain: penulisan kata sandi baru hanya boleh
 * terjadi bila sesi pemanggil masih hidup dan hash yang tadi diverifikasi belum berubah.
 */
const NEW_PASSWORD = "SandiBaru2026";
const OTHER_PASSWORD = "SandiLain2026";

let schoolId = "";
let sa: Actor;

before(async () => {
  resetAllLimiters();
  schoolId = (await createSchool()).id;
  sa = await actor(await createSuperAdmin());
});
after(disconnect);

const changePassword = (bearer: string) =>
  callRoute<Envelope<{ changed: true; otherSessionsRevoked: number }>>(changePasswordRoute, {
    method: "POST",
    url: "/api/v1/auth/change-password",
    bearer,
    json: { currentPassword: DEFAULT_TEST_PASSWORD, newPassword: NEW_PASSWORD },
  });

const adminReset = (userId: string) =>
  callRoute<Envelope<{ mustChangePassword: boolean; temporaryPassword?: string }>>(resetRoute, {
    method: "POST",
    url: `/api/v1/platform/users/${userId}/reset-password`,
    bearer: sa.token,
    params: { id: userId },
    json: {},
  });

const credentialOf = (userId: string) =>
  prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, mustChangePassword: true } });

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("reset admin ~20 ms setelah ganti kata sandi dimulai: kata sandi sementara admin selalu menang", async () => {
  for (let round = 0; round < 3; round += 1) {
    const admin = await createSchoolAdmin(schoolId);
    const tokens = await loginOk(admin.email ?? "");
    const change = changePassword(tokens.accessToken);
    await pause(20);
    const reset = await adminReset(admin.id);
    const changed = await change;
    assert.equal(reset.status, 200);
    assert.ok([200, 401, 409].includes(changed.status), `ganti kata sandi -> ${changed.status}`);
    const row = await credentialOf(admin.id);
    assert.equal(await verifyPassword(reset.body?.data.temporaryPassword ?? "", row.passwordHash), true, `putaran ${round}: sandi sementara`);
    assert.equal(row.mustChangePassword, true, `putaran ${round}: wajib ganti tetap aktif`);
  }
});

test("reset yang commit di antara verifikasi dan penulisan -> 401 SESSION_INVALID, reset tidak tertimpa", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  const resetHash = await hashTestPassword(OTHER_PASSWORD);
  const holder = holdTransaction(async (tx) => {
    await lockKey(tx, userLockKey(admin.id));
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash: resetHash, mustChangePassword: true } });
    await revokeAllSessions(tx, admin.id, "ADMIN_REVOKED", new Date());
  });
  await holder.ready;
  const change = changePassword(tokens.accessToken);
  await waitUntilBlocked(change, [APP_LOCK_SQL, USER_UPDATE_SQL]);
  await holder.commit();
  const res = await change;
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "SESSION_INVALID");
  const row = await credentialOf(admin.id);
  assert.equal(await verifyPassword(OTHER_PASSWORD, row.passwordHash), true);
  assert.equal(row.mustChangePassword, true);
});

test("hash berubah oleh penulis lain (tanpa kunci user) -> 409 PASSWORD_CHANGED_CONCURRENTLY (compare-and-set)", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  const otherHash = await hashTestPassword(OTHER_PASSWORD);
  const holder = holdTransaction(async (tx) => {
    await tx.user.update({ where: { id: admin.id }, data: { passwordHash: otherHash } });
  });
  await holder.ready;
  const change = changePassword(tokens.accessToken);
  await waitUntilBlocked(change, [USER_UPDATE_SQL]);
  await holder.commit();
  const res = await change;
  assert.equal(res.status, 409);
  assert.equal(res.body?.error?.code, "PASSWORD_CHANGED_CONCURRENTLY");
  assert.equal(await verifyPassword(OTHER_PASSWORD, (await credentialOf(admin.id)).passwordHash), true);
  assert.equal(await prisma.auditLog.count({ where: { action: "auth.password_change", entityId: admin.id } }), 0);
});

test("dua ganti kata sandi bersamaan dari sesi yang sama: tepat satu berhasil, hash = milik pemenang", async () => {
  const admin = await createSchoolAdmin(schoolId);
  const tokens = await loginOk(admin.email ?? "");
  const bodies = [NEW_PASSWORD, OTHER_PASSWORD].map((newPassword) => ({ currentPassword: DEFAULT_TEST_PASSWORD, newPassword }));
  const results = await Promise.all(
    bodies.map((json) =>
      callRoute<Envelope<unknown>>(changePasswordRoute, { method: "POST", url: "/api/v1/auth/change-password", bearer: tokens.accessToken, json }),
    ),
  );
  const winners = results.flatMap((res, index) => (res.status === 200 ? [bodies[index]?.newPassword ?? ""] : []));
  assert.equal(winners.length, 1, `status: ${results.map((r) => r.status).join(",")}`);
  assert.ok(results.every((res) => [200, 400, 409].includes(res.status)));
  assert.equal(await verifyPassword(winners[0] ?? "", (await credentialOf(admin.id)).passwordHash), true);
});
