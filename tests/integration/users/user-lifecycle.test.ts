import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as activateRoute } from "@/app/api/v1/platform/users/[id]/activate/route";
import { POST as deactivateRoute } from "@/app/api/v1/platform/users/[id]/deactivate/route";
import { POST as resetRoute } from "@/app/api/v1/platform/users/[id]/reset-password/route";
import { POST as revokeRoute } from "@/app/api/v1/platform/users/[id]/revoke-sessions/route";
import { GET as listProvinces } from "@/app/api/v1/regions/provinces/route";
import { verifyPassword } from "@/lib/auth/password";
import type { ActionContext } from "@/lib/auth/principal";
import { makePrincipal } from "@/lib/auth/test-principal";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { deactivateUserTx } from "@/lib/users/service";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchoolAdmin, createSponsor, createSuperAdmin } from "../helpers/factories";
import { callRoute, type AnyRouteHandler, type Envelope } from "../helpers/request";
import { setupTwoSchools, type TwoSchools } from "../schools/fixtures";

let fx: TwoSchools;

before(async () => {
  resetAllLimiters();
  fx = await setupTwoSchools();
});
after(disconnect);

const post = <T>(handler: AnyRouteHandler, action: string, token: string, id: string, json?: unknown) =>
  callRoute<Envelope<T>>(handler, { method: "POST", url: `/api/v1/platform/users/${id}/${action}`, bearer: token, params: { id }, json });

type Deactivated = { id: string; isActive: boolean; revokedSessions: number };
const deactivate = (token: string, id: string, json: unknown = { reason: "Pelanggaran kebijakan" }) =>
  post<Deactivated>(deactivateRoute, "deactivate", token, id, json);
const activate = (token: string, id: string) => post<{ id: string; isActive: boolean }>(activateRoute, "activate", token, id);
const revoke = (token: string, id: string) => post<{ revokedCount: number }>(revokeRoute, "revoke-sessions", token, id);
const reset = (token: string, id: string, json: unknown = {}) =>
  post<{ mustChangePassword: boolean; temporaryPassword?: string }>(resetRoute, "reset-password", token, id, json);

const provincesStatus = async (token: string): Promise<number> =>
  (await callRoute(listProvinces, { method: "GET", url: "/api/v1/regions/provinces", bearer: token })).status;

describe("POST /platform/users/{id}/deactivate & activate", () => {
  test("nonaktifkan admin sekolah: sesi dicabut, token 401, audit; ulang 409; aktifkan lagi", async () => {
    const admin = await createSchoolAdmin(fx.schoolA.id);
    const session = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    assert.equal(await provincesStatus(session.token), 200);
    const res = await deactivate(fx.sa.token, admin.id);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, { id: admin.id, isActive: false, revokedSessions: 1 });
    assert.equal(await provincesStatus(session.token), 401);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: admin.id, action: "user.deactivate" } });
    assert.deepEqual(audit.after, { isActive: false, reason: "Pelanggaran kebijakan", revokedSessions: 1 });
    assert.equal(audit.schoolId, fx.schoolA.id);
    assert.equal((await deactivate(fx.sa.token, admin.id)).body?.error?.code, "USER_ALREADY_INACTIVE");

    const back = await activate(fx.sa.token, admin.id);
    assert.deepEqual(back.body?.data, { id: admin.id, isActive: true });
    assert.equal((await activate(fx.sa.token, admin.id)).body?.error?.code, "USER_ALREADY_ACTIVE");
    assert.equal(await provincesStatus(session.token), 401);
    const fresh = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    assert.equal(await provincesStatus(fresh.token), 200);
  });

  test("nonaktifkan akun sponsor & super admin lain (masih ada super admin aktif)", async () => {
    const { user: sponsorUser } = await createSponsor();
    assert.equal((await deactivate(fx.sa.token, sponsorUser.id)).status, 200);
    const other = await createSuperAdmin();
    assert.equal((await deactivate(fx.sa.token, other.id)).status, 200);
  });

  test("siswa 400 USE_STUDENT_STATUS; diri sendiri 400 CANNOT_TARGET_SELF; id asing 404; alasan wajib 400", async () => {
    assert.equal((await deactivate(fx.sa.token, fx.student.user.id)).body?.error?.code, "USE_STUDENT_STATUS");
    assert.equal((await activate(fx.sa.token, fx.student.user.id)).body?.error?.code, "USE_STUDENT_STATUS");
    assert.equal((await deactivate(fx.sa.token, fx.sa.user.id)).body?.error?.code, "CANNOT_TARGET_SELF");
    assert.equal((await deactivate(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await activate(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await deactivate(fx.sa.token, fx.adminB.user.id, {})).status, 400);
    assert.equal((await deactivate(fx.sa.token, fx.adminB.user.id, { reason: "ok" })).status, 400);
  });

  test("selain super admin -> 403", async () => {
    assert.equal((await deactivate(fx.adminA.token, fx.adminB.user.id)).status, 403);
    assert.equal((await activate(fx.adminA.token, fx.adminB.user.id)).status, 403);
    assert.equal((await deactivate(fx.sponsor.token, fx.adminB.user.id)).status, 403);
  });

  test("super admin aktif terakhir -> 409 LAST_SUPER_ADMIN (dalam transaksi yang di-rollback)", async () => {
    const target = await createSuperAdmin();
    const ctx: ActionContext = {
      principal: makePrincipal({ userId: fx.sa.user.id, role: "SUPER_ADMIN", schoolId: null }),
      now: new Date(),
      requestId: "uji-last-sa",
      ip: null,
      userAgent: null,
      defer: () => undefined,
    };
    const ROLLBACK = new Error("rollback");
    const outcome = await prisma
      .$transaction(async (tx) => {
        await tx.user.updateMany({ where: { role: "SUPER_ADMIN", isActive: true, id: { not: target.id } }, data: { isActive: false } });
        await assert.rejects(deactivateUserTx(tx, target.id, "Uji terakhir", ctx), (error: { status?: number; code?: string }) => {
          assert.equal(error.status, 409);
          assert.equal(error.code, "LAST_SUPER_ADMIN");
          return true;
        });
        throw ROLLBACK;
      })
      .catch((error: unknown) => error);
    assert.equal(outcome, ROLLBACK);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: fx.sa.user.id } })).isActive, true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isActive, true);
  });
});

describe("POST /platform/users/{id}/revoke-sessions", () => {
  test("mencabut semua sesi (ADMIN_REVOKED) + audit; diri sendiri 400", async () => {
    const admin = await createSchoolAdmin(fx.schoolB.id);
    const a = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    await createSessionToken(admin.id, { platform: "ANDROID", deviceId: "hp-admin-1" });
    const res = await revoke(fx.sa.token, admin.id);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, { revokedCount: 2 });
    assert.equal(await provincesStatus(a.token), 401);
    assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: a.sessionId } })).revokeReason, "ADMIN_REVOKED");
    assert.ok(await prisma.auditLog.findFirst({ where: { entityId: admin.id, action: "user.revoke_sessions" } }));
    assert.equal((await revoke(fx.sa.token, fx.sa.user.id)).body?.error?.code, "CANNOT_TARGET_SELF");
    assert.equal((await revoke(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await revoke(fx.adminB.token, admin.id)).status, 403);
  });
});

describe("POST /platform/users/{id}/reset-password", () => {
  async function hashOf(userId: string): Promise<string> {
    return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, omit: { passwordHash: false } })).passwordHash;
  }

  test("tanpa kata sandi: sementara dikembalikan sekali, sesi dicabut, wajib ganti, audit tanpa kata sandi", async () => {
    const admin = await createSchoolAdmin(fx.schoolA.id);
    const session = await createSessionToken(admin.id, { platform: "WEB", deviceId: null });
    const res = await reset(fx.sa.token, admin.id);
    assert.equal(res.status, 200);
    const temp = res.body?.data.temporaryPassword ?? "";
    assert.equal(res.body?.data.mustChangePassword, true);
    assert.equal(temp.length, 10);
    assert.equal(await verifyPassword(temp, await hashOf(admin.id)), true);
    assert.equal(await provincesStatus(session.token), 401);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(row.mustChangePassword, true);
    assert.ok(row.tempPasswordExpiresAt && row.passwordChangedAt);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: admin.id, action: "user.reset_password" } });
    assert.deepEqual(audit.after, { credential: "GENERATED", revokedSessions: 1 });
    assert.doesNotMatch(JSON.stringify(audit), new RegExp(temp));
  });

  test("kata sandi diketik: tanpa temporaryPassword & tanpa kedaluwarsa; lemah 422", async () => {
    const { user } = await createSponsor();
    const res = await reset(fx.sa.token, user.id, { newPassword: "SponsorKuat77" });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body?.data, { mustChangePassword: true });
    assert.equal(await verifyPassword("SponsorKuat77", await hashOf(user.id)), true);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).tempPasswordExpiresAt, null);
    const weak = await reset(fx.sa.token, user.id, { newPassword: "abcdefgh" });
    assert.equal(weak.status, 422);
    assert.equal(weak.body?.error?.code, "PASSWORD_POLICY");
  });

  test("siswa 400 USE_STUDENT_ENDPOINT; diri sendiri 400 USE_CHANGE_PASSWORD; kunci asing 400; id asing 404; admin sekolah 403", async () => {
    assert.equal((await reset(fx.sa.token, fx.student.user.id)).body?.error?.code, "USE_STUDENT_ENDPOINT");
    assert.equal((await reset(fx.sa.token, fx.sa.user.id)).body?.error?.code, "USE_CHANGE_PASSWORD");
    assert.equal((await reset(fx.sa.token, fx.adminB.user.id, { password: "x" })).status, 400);
    assert.equal((await reset(fx.sa.token, "tidak-ada")).status, 404);
    assert.equal((await reset(fx.adminA.token, fx.adminB.user.id)).status, 403);
  });
});
