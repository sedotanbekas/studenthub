/**
 * Langganan Web Push (N3): GET/PUT/DELETE /api/v1/me/web-push*, pemindahan endpoint antarakun, validasi (SSRF, titik
 * P-256), batas laju, dan penghapusan langganan saat sesi dicabut (termasuk balapan logout vs PUT).
 */
import { after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { GET as statusRoute } from "@/app/api/v1/me/web-push/route";
import { DELETE as deleteRoute, PUT as putRoute } from "@/app/api/v1/me/web-push/subscription/route";
import { revokeAllSessions, revokeSchoolSessions, revokeSession } from "@/lib/auth/sessions";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { endpointHashOf } from "@/lib/push/web/rules";
import { withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";

beforeEach(resetAllLimiters);
after(disconnect);

interface Status { enabled: boolean; publicKey: string | null; subscribed: boolean }

function p256dh(): string {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
}

const subscription = (endpoint = `https://fcm.googleapis.com/fcm/send/${uniq("ep")}`) => ({ endpoint, expirationTime: null, keys: { p256dh: p256dh(), auth: Buffer.alloc(16, 3).toString("base64url") } });

async function webAdmin() {
  const school = await createSchool();
  const user = await createSchoolAdmin(school.id);
  const session = await createSessionToken(user.id, { platform: "WEB", deviceId: null });
  return { school, user, ...session };
}

const status = (token: string) => callRoute<Envelope<Status>>(statusRoute, { method: "GET", url: "/api/v1/me/web-push", bearer: token });
const put = (token: string, json: unknown) => callRoute<Envelope<{ subscribed: boolean }>>(putRoute, { method: "PUT", url: "/api/v1/me/web-push/subscription", bearer: token, json });
const remove = (token: string) => callRoute<Envelope<{ subscribed: boolean }>>(deleteRoute, { method: "DELETE", url: "/api/v1/me/web-push/subscription", bearer: token });

test("status sebelum & sesudah PUT; PUT idempoten (satu baris, lastUsedAt maju); endpoint baru di sesi sama menggantikan", async () => {
  const a = await webAdmin();
  const before = await status(a.token);
  assert.equal(before.status, 200, JSON.stringify(before.body?.error));
  assert.equal(before.body?.data.enabled, true);
  assert.match(before.body?.data.publicKey ?? "", /^B[A-Za-z0-9_-]{86}$/);
  assert.equal(before.body?.data.subscribed, false);

  const sub = subscription();
  assert.deepEqual((await put(a.token, sub)).body?.data, { subscribed: true });
  const first = await prisma.webPushSubscription.findFirstOrThrow({ where: { sessionId: a.sessionId } });
  assert.equal(first.endpointHash, endpointHashOf(sub.endpoint));
  await new Promise((r) => setTimeout(r, 15));
  assert.equal((await put(a.token, sub)).status, 200);
  const rows = await prisma.webPushSubscription.findMany({ where: { sessionId: a.sessionId } });
  assert.equal(rows.length, 1);
  assert.ok(rows[0]!.lastUsedAt > first.lastUsedAt);
  assert.equal((await status(a.token)).body?.data.subscribed, true);

  const next = subscription();
  await put(a.token, next);
  const replaced = await prisma.webPushSubscription.findMany({ where: { sessionId: a.sessionId } });
  assert.deepEqual(replaced.map((r) => r.endpoint), [next.endpoint]);
});

test("ganti akun di browser yang sama: endpoint pindah ke sesi & akun baru", async () => {
  const a = await webAdmin();
  const b = await createSessionToken((await createSchoolAdmin(a.school.id)).id, { platform: "WEB", deviceId: null });
  const sub = subscription();
  await put(a.token, sub);
  await withTx((tx) => revokeSession(tx, a.sessionId, "LOGOUT", new Date()));
  assert.equal((await put(b.token, sub)).status, 200);
  const row = await prisma.webPushSubscription.findUniqueOrThrow({ where: { endpointHash: endpointHashOf(sub.endpoint) } });
  assert.equal(row.sessionId, b.sessionId);
  assert.notEqual(row.userId, a.user.id);
});

test("validasi: sesi aplikasi 422, endpoint asing/http/IP 422, titik P-256 rusak 422, bentuk kunci 400, tanpa login 401, wajib ganti sandi 403", async () => {
  const school = await createSchool();
  const st = await createStudent(school.id);
  const app = await createSessionToken(st.user.id, { platform: "ANDROID", deviceId: uniq("dev") });
  assert.equal((await put(app.token, subscription())).body?.error?.code, "WEB_PUSH_APP_SESSION");
  const a = await webAdmin();
  for (const endpoint of ["https://evil.example/push", "http://fcm.googleapis.com/fcm/send/x", "https://10.0.0.5/fcm/send/x"]) {
    const res = await put(a.token, subscription(endpoint));
    assert.deepEqual([res.status, res.body?.error?.code], [422, "WEB_PUSH_ENDPOINT_INVALID"], endpoint);
  }
  const offCurve = Buffer.alloc(65, 1);
  offCurve[0] = 4;
  assert.equal((await put(a.token, { ...subscription(), keys: { p256dh: offCurve.toString("base64url"), auth: Buffer.alloc(16, 3).toString("base64url") } })).body?.error?.code, "WEB_PUSH_ENDPOINT_INVALID");
  assert.equal((await put(a.token, { ...subscription(), keys: { p256dh: "pendek", auth: "x" } })).status, 400);
  assert.equal((await put(a.token, { ...subscription(), extra: 1 })).status, 400);
  assert.equal((await callRoute(putRoute, { method: "PUT", url: "/api/v1/me/web-push/subscription", json: subscription() })).status, 401);
  const forced = await createSchoolAdmin(school.id, { mustChangePassword: true });
  const forcedSession = await createSessionToken(forced.id, { platform: "WEB", deviceId: null });
  assert.equal((await status(forcedSession.token)).body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal(await prisma.webPushSubscription.count({ where: { userId: a.user.id } }), 0);
});

test("DELETE idempoten; PUT ke-21 dalam 10 menit -> 429", async () => {
  const a = await webAdmin();
  await put(a.token, subscription());
  assert.deepEqual((await remove(a.token)).body?.data, { subscribed: false });
  assert.deepEqual((await remove(a.token)).body?.data, { subscribed: false });
  assert.equal(await prisma.webPushSubscription.count({ where: { sessionId: a.sessionId } }), 0);
  const sub = subscription();
  for (let i = 0; i < 19; i += 1) assert.equal((await put(a.token, sub)).status, 200);
  const limited = await put(a.token, sub);
  assert.equal(limited.status, 429);
});

test("pencabutan sesi menghapus langganannya: satu sesi, semua kecuali satu, satu sekolah", async () => {
  const a = await webAdmin();
  const other = await createSessionToken(a.user.id, { platform: "WEB", deviceId: null });
  const third = await createSessionToken(a.user.id, { platform: "WEB", deviceId: null });
  for (const s of [a, other, third]) await put(s.token, subscription());
  await withTx((tx) => revokeSession(tx, a.sessionId, "LOGOUT", new Date()));
  assert.equal(await prisma.webPushSubscription.count({ where: { sessionId: a.sessionId } }), 0);
  await withTx((tx) => revokeAllSessions(tx, a.user.id, "PASSWORD_CHANGED", new Date(), third.sessionId));
  assert.deepEqual((await prisma.webPushSubscription.findMany({ where: { userId: a.user.id } })).map((r) => r.sessionId), [third.sessionId], "sesi yang dikecualikan tetap");
  await withTx((tx) => revokeSchoolSessions(tx, a.school.id, "ACCOUNT_DISABLED", new Date()));
  assert.equal(await prisma.webPushSubscription.count({ where: { userId: a.user.id } }), 0);
  assert.equal((await put(third.token, subscription())).status, 401, "sesi dicabut tidak bisa berlangganan lagi");
});

test("balapan logout vs PUT: tidak pernah ada langganan tertinggal di sesi yang dicabut", async () => {
  for (let i = 0; i < 4; i += 1) {
    const a = await webAdmin();
    const [res] = await Promise.all([put(a.token, subscription()), withTx((tx) => revokeSession(tx, a.sessionId, "LOGOUT", new Date()))]);
    assert.ok([200, 401].includes(res.status), String(res.status));
    assert.equal(await prisma.webPushSubscription.count({ where: { sessionId: a.sessionId } }), 0);
  }
});
