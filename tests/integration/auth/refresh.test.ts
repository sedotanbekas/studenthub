import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { hashRefreshToken } from "@/lib/auth/refresh-rules";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { callRoute } from "../helpers/request";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { loginOk, me, refresh, uniqIp } from "./helpers";

let schoolId = "";

before(async () => {
  resetAllLimiters();
  schoolId = (await createSchool()).id;
});
after(disconnect);

async function adminTokens(platform: "WEB" | "ANDROID" = "WEB") {
  const admin = await createSchoolAdmin(schoolId);
  return { admin, tokens: await loginOk(admin.email ?? "", { platform }) };
}

/** Mundurkan rotatedAt token lama agar keluar dari jendela grace 30 s. */
async function ageRotation(rawToken: string, ms: number): Promise<void> {
  await prisma.refreshToken.update({ where: { tokenHash: hashRefreshToken(rawToken) }, data: { rotatedAt: new Date(Date.now() - ms) } });
}

test("rotasi: token baru, token lama ditandai rotatedAt, sesi diperbarui, access token baru berlaku", async () => {
  const { tokens } = await adminTokens("ANDROID");
  const res = await refresh(tokens.refreshToken, "10.9.8.7");
  assert.equal(res.status, 200);
  const next = res.body?.data;
  assert.ok(next);
  assert.notEqual(next.refreshToken, tokens.refreshToken);
  assert.equal(next.sessionId, tokens.sessionId);
  const old = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(tokens.refreshToken) } });
  assert.ok(old.rotatedAt);
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } });
  assert.equal(session.ipAddress, "10.9.8.7");
  assert.ok(Date.parse(next.refreshTokenExpiresAt) <= session.expiresAt.getTime());
  assert.equal((await me(next.accessToken)).status, 200);
});

test("token tak dikenal -> 401 SESSION_INVALID; bentuk salah -> 400", async () => {
  const res = await refresh("token-yang-tidak-pernah-ada");
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "SESSION_INVALID");
  for (const json of [{}, { refreshToken: "" }, { refreshToken: "x", extra: true }]) {
    const bad = await callRoute(refreshRoute, { method: "POST", url: "/api/v1/auth/refresh", json, headers: { "x-real-ip": uniqIp() } });
    assert.equal(bad.status, 400, JSON.stringify(json));
  }
});

test("pakai ulang dalam 30 s -> 409 REFRESH_RACE, sesi tetap hidup", async () => {
  const { tokens } = await adminTokens();
  const first = await refresh(tokens.refreshToken);
  assert.equal(first.status, 200);
  const race = await refresh(tokens.refreshToken);
  assert.equal(race.status, 409);
  assert.equal(race.body?.error?.code, "REFRESH_RACE");
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } });
  assert.equal(session.revokedAt, null);
  assert.equal((await refresh(first.body?.data.refreshToken ?? "")).status, 200);
});

test("pakai ulang > 30 s -> sesi dicabut TOKEN_REUSE + audit; access token & token baru langsung 401", async () => {
  const { admin, tokens } = await adminTokens("ANDROID");
  const rotated = await refresh(tokens.refreshToken);
  const next = rotated.body?.data;
  assert.ok(next);
  await ageRotation(tokens.refreshToken, 31_000);
  const reuse = await refresh(tokens.refreshToken);
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body?.error?.code, "SESSION_INVALID");
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } });
  assert.equal(session.revokeReason, "TOKEN_REUSE");
  const audit = await prisma.auditLog.findFirst({ where: { action: "auth.token_reuse", entityId: tokens.sessionId } });
  assert.ok(audit);
  assert.equal(audit.schoolId, schoolId);
  assert.equal((audit.after as { userId?: string }).userId, admin.id);
  const stale = await me(next.accessToken);
  assert.equal(stale.status, 401);
  assert.equal(stale.body?.error?.code, "SESSION_INVALID");
  assert.equal((await refresh(next.refreshToken)).status, 401);
});

test("dua refresh paralel dengan token yang sama -> tepat satu berhasil, sisanya 409", async () => {
  const { tokens } = await adminTokens("ANDROID");
  const results = await Promise.all([refresh(tokens.refreshToken), refresh(tokens.refreshToken), refresh(tokens.refreshToken)]);
  const statuses = results.map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409, 409]);
  const live = await prisma.refreshToken.count({ where: { sessionId: tokens.sessionId, rotatedAt: null } });
  assert.equal(live, 1, "hanya satu token pengganti yang diterbitkan");
});

test("akun dinonaktifkan -> refresh 401 ACCOUNT_INACTIVE dan sesi dicabut ACCOUNT_DISABLED", async () => {
  const { admin, tokens } = await adminTokens();
  await prisma.user.update({ where: { id: admin.id }, data: { isActive: false } });
  const res = await refresh(tokens.refreshToken);
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "ACCOUNT_INACTIVE");
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } });
  assert.equal(session.revokeReason, "ACCOUNT_DISABLED");
});

test("siswa dipindah (MOVED) -> refresh 401 ACCOUNT_INACTIVE", async () => {
  const { user, student } = await createStudent(schoolId);
  const tokens = await loginOk(student.nisn, { platform: "ANDROID" });
  await prisma.student.update({ where: { id: student.id }, data: { status: "MOVED", activeNisn: null } });
  await prisma.user.update({ where: { id: user.id }, data: { isActive: false } });
  const res = await refresh(tokens.refreshToken);
  assert.equal(res.status, 401);
  assert.equal(res.body?.error?.code, "ACCOUNT_INACTIVE");
});

test("refresh token kedaluwarsa atau sesi dicabut -> 401 SESSION_INVALID", async () => {
  const expired = (await adminTokens()).tokens;
  await prisma.refreshToken.update({ where: { tokenHash: hashRefreshToken(expired.refreshToken) }, data: { expiresAt: new Date(Date.now() - 1000) } });
  assert.equal((await refresh(expired.refreshToken)).body?.error?.code, "SESSION_INVALID");
  const revoked = (await adminTokens()).tokens;
  await prisma.authSession.update({ where: { id: revoked.sessionId }, data: { revokedAt: new Date(), revokeReason: "LOGOUT" } });
  assert.equal((await refresh(revoked.refreshToken)).body?.error?.code, "SESSION_INVALID");
});

test("limiter REFRESH_IP: melewati batas per menit per IP -> 429 + Retry-After", async () => {
  const ip = uniqIp();
  const { RATE_LIMITS } = await import("@/lib/http/rate-limits");
  for (let i = 0; i < RATE_LIMITS.REFRESH_IP.limit; i += 1) assert.equal((await refresh(`tidak-ada-${i}`, ip)).status, 401);
  const limited = await refresh("tidak-ada-lagi", ip);
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
});
