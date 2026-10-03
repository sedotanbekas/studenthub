/**
 * Dispatcher push dengan Web Push (N3, transport memori): semua peran, tautan per peran + ?notif, badge = belum
 * dibaca, Expo & web berdampingan, 404/410 menghapus langganan, 503 diulang, 403 gagal permanen, sesi mati dilewati.
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { notifySchoolAdmins } from "@/lib/notifications/notify";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import { memoryPushTransport } from "@/lib/push/transports/memory";
import { endpointHashOf } from "@/lib/push/web/rules";
import { memoryWebPushTransport } from "@/lib/push/web/transports/web-memory";
import { withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { jobCtx, notificationRow, pendingNotification, pushSchool, studentWithDevices } from "./helpers";

after(disconnect);
afterEach(() => {
  memoryPushTransport.reset();
  memoryWebPushTransport.reset();
});

let schoolId: string;
before(async () => {
  schoolId = await pushSchool();
});

function p256dh(): string {
  const jwk = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  return Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]).toString("base64url");
}

/** Langganan Web Push pada sesi WEB baru milik user; `state` membuat sesinya dicabut/kedaluwarsa. */
async function webDevice(userId: string, state: "live" | "revoked" | "expired" = "live") {
  const { sessionId } = await createSessionToken(userId, { platform: "WEB", deviceId: null, ...(state === "expired" ? { expiresAt: new Date(Date.now() - 60_000) } : {}) });
  if (state === "revoked") await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date(), revokeReason: "LOGOUT" } });
  const endpoint = `https://fcm.googleapis.com/fcm/send/${uniq("ep")}`;
  return prisma.webPushSubscription.create({
    data: { userId, sessionId, endpoint, endpointHash: endpointHashOf(endpoint), p256dh: p256dh(), auth: Buffer.alloc(16, 5).toString("base64url"), lastUsedAt: new Date("2026-01-01T00:00:00Z") },
  });
}

const sentFor = (notificationId: string) => memoryWebPushTransport.sent().filter((s) => s.payload.notificationId === notificationId);

test("admin sekolah: PAYMENT_SUBMITTED dikirim lewat web -> SENT; tautan /hub/billing?notif, badge = belum dibaca, TTL wajar, lastUsedAt maju", async () => {
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const device = await webDevice(admin.id);
  const now = new Date();
  await withTx((tx) => notifySchoolAdmins(tx, school.id, { type: "PAYMENT_SUBMITTED", title: "Bukti transfer baru", body: "Menunggu verifikasi", link: { screen: "payment-review", id: "sub1" } }, { now }));
  const row = await prisma.notification.findFirstOrThrow({ where: { userId: admin.id, type: "PAYMENT_SUBMITTED" } });
  assert.equal(row.pushStatus, "PENDING");
  const summary = await dispatchPendingPushes(jobCtx(now, [admin.id]), memoryPushTransport, memoryWebPushTransport);
  assert.equal(summary.sent, 1);
  assert.equal((await notificationRow(row.id)).pushStatus, "SENT");
  const [sent] = sentFor(row.id);
  assert.equal(sent?.payload.url, `/hub/billing?notif=${row.id}`);
  assert.equal(sent?.payload.badge, await prisma.notification.count({ where: { userId: admin.id, readAt: null } }));
  assert.ok(sent && sent.ttlSeconds > 3000 && sent.ttlSeconds <= 3600, String(sent?.ttlSeconds));
  assert.equal(sent?.target.endpoint, device.endpoint);
  assert.ok((await prisma.webPushSubscription.findUniqueOrThrow({ where: { id: device.id } })).lastUsedAt > device.lastUsedAt);
});

test("siswa dengan Expo + web: keduanya dikirim; sesi web dicabut/kedaluwarsa dilewati", async () => {
  const st = await studentWithDevices(schoolId, 1);
  await webDevice(st.user.id);
  await webDevice(st.user.id, "revoked");
  await webDevice(st.user.id, "expired");
  const now = new Date();
  const id = await pendingNotification(st.user.id, now);
  await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport, memoryWebPushTransport);
  assert.equal(memoryPushTransport.sent().filter((m) => m.data.notificationId === id).length, 1);
  assert.equal(sentFor(id).length, 1);
  assert.equal(sentFor(id)[0]?.payload.url, `/hub/my-billing?notif=${id}`);
  assert.equal((await notificationRow(id)).pushStatus, "SENT");
});

test("410 di satu-satunya perangkat -> langganan dihapus, FAILED; 410 + ok di perangkat lain -> SENT", async () => {
  const st = await createStudent(schoolId);
  const dead = await webDevice(st.user.id);
  memoryWebPushTransport.setStatusScript((item) => (item.target.endpoint === dead.endpoint ? { kind: "unregistered" } : undefined));
  const now = new Date();
  const only = await pendingNotification(st.user.id, now);
  const summary = await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport, memoryWebPushTransport);
  assert.equal(summary.tokensCleared, 1);
  assert.deepEqual([(await notificationRow(only)).pushStatus, (await notificationRow(only)).pushError], ["FAILED", "DeviceNotRegistered"]);
  assert.equal(await prisma.webPushSubscription.count({ where: { id: dead.id } }), 0);

  const dying = await webDevice(st.user.id);
  await webDevice(st.user.id);
  memoryWebPushTransport.setStatusScript((item) => (item.target.endpoint === dying.endpoint ? { kind: "unregistered" } : undefined));
  const mixed = await pendingNotification(st.user.id, now);
  await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport, memoryWebPushTransport);
  assert.equal((await notificationRow(mixed)).pushStatus, "SENT");
  assert.equal(await prisma.webPushSubscription.count({ where: { id: dying.id } }), 0);
});

test("503 -> PENDING dengan backoff; 403 -> FAILED HTTP_403 dan langganan tetap", async () => {
  const a = await createStudent(schoolId);
  const b = await createStudent(schoolId);
  const busy = await webDevice(a.user.id);
  const denied = await webDevice(b.user.id);
  memoryWebPushTransport.setStatusScript((item) => {
    if (item.target.endpoint === busy.endpoint) return { kind: "retry", error: "HTTP_503" };
    if (item.target.endpoint === denied.endpoint) return { kind: "fail", error: "HTTP_403" };
    return undefined;
  });
  const now = new Date();
  const [ra, rb] = [await pendingNotification(a.user.id, now), await pendingNotification(b.user.id, now)];
  await dispatchPendingPushes(jobCtx(now, [a.user.id, b.user.id]), memoryPushTransport, memoryWebPushTransport);
  const retry = await notificationRow(ra);
  assert.deepEqual([retry.pushStatus, retry.pushError], ["PENDING", "HTTP_503"]);
  assert.ok(retry.pushNextAttemptAt > now);
  assert.deepEqual([(await notificationRow(rb)).pushStatus, (await notificationRow(rb)).pushError], ["FAILED", "HTTP_403"]);
  assert.equal(await prisma.webPushSubscription.count({ where: { id: denied.id } }), 1);
});

test("Web Push mati (transport null) -> langganan web diabaikan; tanpa perangkat lain -> SKIPPED NO_DEVICE", async () => {
  const st = await createStudent(schoolId);
  await webDevice(st.user.id);
  const now = new Date();
  const id = await pendingNotification(st.user.id, now);
  await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport, null);
  assert.deepEqual([(await notificationRow(id)).pushStatus, (await notificationRow(id)).pushError], ["SKIPPED", "NO_DEVICE"]);
  assert.equal(sentFor(id).length, 0);
});
