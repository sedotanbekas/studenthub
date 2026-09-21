import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAllRoute } from "@/app/api/v1/auth/logout-all/route";
import { GET as listSessionsRoute } from "@/app/api/v1/me/sessions/route";
import { DELETE as revokeSessionRoute } from "@/app/api/v1/me/sessions/[id]/route";
import { DELETE as removePushRoute, PUT as putPushRoute } from "@/app/api/v1/me/push-token/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { loginOk, me, uniqPushToken } from "./helpers";

interface SessionItem {
  id: string;
  platform: string;
  deviceName: string | null;
  ipAddress: string | null;
  lastUsedAt: string;
  createdAt: string;
  isCurrent: boolean;
}

let schoolA = "";
let schoolB = "";

before(async () => {
  resetAllLimiters();
  schoolA = (await createSchool()).id;
  schoolB = (await createSchool()).id;
});
after(disconnect);

async function adminLogin(schoolId: string, platform: "WEB" | "ANDROID" | "IOS" = "WEB") {
  const admin = await createSchoolAdmin(schoolId);
  return { admin, tokens: await loginOk(admin.email ?? "", { platform }) };
}

const listSessions = (bearer: string) =>
  callRoute<Envelope<SessionItem[]>>(listSessionsRoute, { method: "GET", url: "/api/v1/me/sessions", bearer });
const deleteSession = (bearer: string, id: string) =>
  callRoute(revokeSessionRoute, { method: "DELETE", url: `/api/v1/me/sessions/${id}`, bearer, params: { id } });
const putPush = (bearer: string, json: unknown) => callRoute(putPushRoute, { method: "PUT", url: "/api/v1/me/push-token", bearer, json });
const removePush = (bearer: string) => callRoute(removePushRoute, { method: "DELETE", url: "/api/v1/me/push-token", bearer });

test("tanpa token -> 401 pada semua endpoint sesi", async () => {
  const calls = [
    callRoute(logoutRoute, { method: "POST", url: "/api/v1/auth/logout" }),
    callRoute(logoutAllRoute, { method: "POST", url: "/api/v1/auth/logout-all" }),
    callRoute(listSessionsRoute, { method: "GET", url: "/api/v1/me/sessions" }),
    callRoute(revokeSessionRoute, { method: "DELETE", url: "/api/v1/me/sessions/x", params: { id: "x" } }),
    callRoute(putPushRoute, { method: "PUT", url: "/api/v1/me/push-token", json: { expoPushToken: uniqPushToken() } }),
    callRoute(removePushRoute, { method: "DELETE", url: "/api/v1/me/push-token" }),
  ];
  for (const res of await Promise.all(calls)) assert.equal(res.status, 401);
});

test("logout mencabut sesi saat ini (LOGOUT, token push dihapus); access token langsung 401", async () => {
  const { tokens } = await adminLogin(schoolA, "ANDROID");
  await putPush(tokens.accessToken, { expoPushToken: uniqPushToken() });
  const res = await callRoute(logoutRoute, { method: "POST", url: "/api/v1/auth/logout", bearer: tokens.accessToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { revoked: true });
  const session = await prisma.authSession.findUniqueOrThrow({ where: { id: tokens.sessionId } });
  assert.equal(session.revokeReason, "LOGOUT");
  assert.equal(session.expoPushToken, null);
  const after = await me(tokens.accessToken);
  assert.equal(after.status, 401);
  assert.equal(after.body?.error?.code, "SESSION_INVALID");
});

test("logout-all mencabut semua sesi milik sendiri saja", async () => {
  const { admin, tokens } = await adminLogin(schoolA);
  const second = await loginOk(admin.email ?? "");
  const other = await adminLogin(schoolA);
  const res = await callRoute(logoutAllRoute, { method: "POST", url: "/api/v1/auth/logout-all", bearer: tokens.accessToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { revokedCount: 2 });
  assert.equal((await me(tokens.accessToken)).status, 401);
  assert.equal((await me(second.accessToken)).status, 401);
  assert.equal((await me(other.tokens.accessToken)).status, 200);
});

test("GET /me/sessions: hanya sesi hidup milik sendiri, isCurrent benar", async () => {
  const { admin, tokens } = await adminLogin(schoolA);
  const second = await loginOk(admin.email ?? "", { platform: "ANDROID", deviceName: "HP Admin" });
  const third = await loginOk(admin.email ?? "");
  await callRoute(logoutRoute, { method: "POST", url: "/api/v1/auth/logout", bearer: third.accessToken });
  await adminLogin(schoolA);
  const res = await listSessions(tokens.accessToken);
  assert.equal(res.status, 200);
  const items = res.body?.data ?? [];
  assert.deepEqual(items.map((s) => s.id).sort(), [tokens.sessionId, second.sessionId].sort());
  assert.equal(items.find((s) => s.id === tokens.sessionId)?.isCurrent, true);
  const phone = items.find((s) => s.id === second.sessionId);
  assert.equal(phone?.isCurrent, false);
  assert.equal(phone?.platform, "ANDROID");
  assert.equal(phone?.deviceName, "HP Admin");
});

test("DELETE /me/sessions/{id}: cabut sesi sendiri; sesi user lain (sekolah lain) -> 404 dan tetap hidup", async () => {
  const { admin, tokens } = await adminLogin(schoolA);
  const mine = await loginOk(admin.email ?? "");
  const res = await deleteSession(tokens.accessToken, mine.sessionId);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { revoked: true });
  assert.equal((await me(mine.accessToken)).status, 401);
  assert.equal((await deleteSession(tokens.accessToken, mine.sessionId)).status, 200, "idempoten");

  const foreign = await adminLogin(schoolB);
  const idor = await deleteSession(tokens.accessToken, foreign.tokens.sessionId);
  assert.equal(idor.status, 404);
  assert.equal((await me(foreign.tokens.accessToken)).status, 200);
  const sameSchool = await adminLogin(schoolA);
  assert.equal((await deleteSession(tokens.accessToken, sameSchool.tokens.sessionId)).status, 404);
  assert.equal((await deleteSession(tokens.accessToken, "tidak-ada")).status, 404);
  assert.equal((await deleteSession(tokens.accessToken, "x".repeat(65))).status, 400);
});

test("PUT /me/push-token: pasang di sesi mobile; pindah antar sesi tanpa bentrok unik", async () => {
  const token = uniqPushToken();
  const first = await adminLogin(schoolA, "ANDROID");
  const res = await putPush(first.tokens.accessToken, { expoPushToken: token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { registered: true });
  assert.equal((await putPush(first.tokens.accessToken, { expoPushToken: token })).status, 200, "idempoten");
  const second = await adminLogin(schoolB, "IOS");
  assert.equal((await putPush(second.tokens.accessToken, { expoPushToken: token })).status, 200);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: first.tokens.sessionId } })).expoPushToken, null);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: second.tokens.sessionId } })).expoPushToken, token);
});

test("PUT /me/push-token: sesi WEB 422, format salah 422, body salah 400", async () => {
  const web = await adminLogin(schoolA, "WEB");
  const onWeb = await putPush(web.tokens.accessToken, { expoPushToken: uniqPushToken() });
  assert.equal(onWeb.status, 422);
  assert.equal(onWeb.body?.error?.code, "PUSH_TOKEN_WEB_SESSION");
  const mobile = await adminLogin(schoolA, "ANDROID");
  const invalid = await putPush(mobile.tokens.accessToken, { expoPushToken: "fcm:bukan-expo" });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body?.error?.code, "PUSH_TOKEN_INVALID");
  assert.equal((await putPush(mobile.tokens.accessToken, { expoPushToken: uniqPushToken(), extra: 1 })).status, 400);
  assert.equal((await putPush(mobile.tokens.accessToken, {})).status, 400);
});

test("DELETE /me/push-token: hapus token sesi mobile; sesi WEB 422", async () => {
  const mobile = await adminLogin(schoolA, "IOS");
  await putPush(mobile.tokens.accessToken, { expoPushToken: uniqPushToken() });
  const res = await removePush(mobile.tokens.accessToken);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { removed: true });
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: mobile.tokens.sessionId } })).expoPushToken, null);
  const web = await adminLogin(schoolA, "WEB");
  assert.equal((await removePush(web.tokens.accessToken)).status, 422);
});

test("endpoint sesi tetap dapat diakses saat wajib ganti kata sandi", async () => {
  const admin = await createSchoolAdmin(schoolA, { mustChangePassword: true });
  const tokens = await loginOk(admin.email ?? "", { platform: "ANDROID" });
  assert.equal((await listSessions(tokens.accessToken)).status, 200);
  assert.equal((await putPush(tokens.accessToken, { expoPushToken: uniqPushToken() })).status, 200);
  assert.equal((await callRoute(logoutRoute, { method: "POST", url: "/api/v1/auth/logout", bearer: tokens.accessToken })).status, 200);
});
