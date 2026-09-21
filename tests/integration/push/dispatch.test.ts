import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { JOB_HANDLERS } from "@/lib/jobs/registry";
import { dispatchPendingPushes } from "@/lib/push/dispatch";
import { memoryPushTransport } from "@/lib/push/transports/memory";
import type { PushTransport } from "@/lib/push/types";
import { disconnect, prisma } from "../helpers/db";
import { createStudent } from "../helpers/factories";
import { createSessionToken } from "../helpers/auth";
import {
  addDevice,
  expoToken,
  jobCtx,
  messagesFor,
  minutesAfter,
  notificationRow,
  pendingNotification,
  pushSchool,
  studentWithDevices,
} from "./helpers";

after(disconnect);
afterEach(() => memoryPushTransport.reset());

let schoolId: string;
before(async () => {
  schoolId = await pushSchool();
});

test("mengirim ke setiap sesi hidup bertoken (dicabut/kedaluwarsa dilewati) -> SENT", async () => {
  const st = await studentWithDevices(schoolId, 2);
  await addDevice(st.user.id, "revoked");
  await addDevice(st.user.id, "expired");
  const now = new Date();
  const id = await pendingNotification(st.user.id, now, `Tagihan SPP bulan September ${"panjang ".repeat(15)}`);
  const summary = await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport);
  assert.deepEqual({ claimed: summary.claimed, sent: summary.sent, skipped: summary.skipped }, { claimed: 1, sent: 1, skipped: 0 });
  const messages = messagesFor(id);
  assert.deepEqual(messages.map((m) => m.to).sort(), st.devices.map((d) => d.token).sort());
  const [first] = messages;
  assert.equal(first?.data.notificationId, id);
  assert.equal(first?.data.screen, "invoice");
  assert.ok(Array.from(first?.title ?? "").length <= 100);
  assert.deepEqual([first?.sound, first?.priority, first?.channelId], ["default", "high", "default"]);
  const row = await notificationRow(id);
  assert.equal(row.pushStatus, "SENT");
  assert.equal(row.pushAttempts, 1);
  assert.equal(row.pushedAt?.getTime(), now.getTime());
  assert.equal(row.pushError, null);
  const again = await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport);
  assert.equal(again.claimed, 0, "SENT tidak dikirim ulang");
});

test("DeviceNotRegistered: token sesi itu dilepas; perangkat lain ok -> SENT; satu-satunya perangkat -> FAILED", async () => {
  const two = await studentWithDevices(schoolId, 2);
  const one = await studentWithDevices(schoolId, 1);
  const dead = new Set([two.devices[0]?.token, one.devices[0]?.token]);
  memoryPushTransport.setTicketScript((m) => (dead.has(m.to) ? { status: "error", message: `${m.to} bukan penerima`, details: { error: "DeviceNotRegistered" } } : undefined));
  const now = new Date();
  const idTwo = await pendingNotification(two.user.id, now);
  const idOne = await pendingNotification(one.user.id, now);
  const summary = await dispatchPendingPushes(jobCtx(now, [two.user.id, one.user.id]), memoryPushTransport);
  assert.deepEqual({ sent: summary.sent, failed: summary.failed, tokensCleared: summary.tokensCleared }, { sent: 1, failed: 1, tokensCleared: 2 });
  assert.equal((await notificationRow(idTwo)).pushStatus, "SENT");
  const failed = await notificationRow(idOne);
  assert.deepEqual([failed.pushStatus, failed.pushError, failed.pushAttempts], ["FAILED", "DeviceNotRegistered", 1]);
  const sessions = await prisma.authSession.findMany({ where: { userId: { in: [two.user.id, one.user.id] } }, select: { id: true, expoPushToken: true } });
  const tokenOf = new Map(sessions.map((s) => [s.id, s.expoPushToken]));
  assert.equal(tokenOf.get(two.devices[0]?.sessionId ?? ""), null);
  assert.equal(tokenOf.get(two.devices[1]?.sessionId ?? ""), two.devices[1]?.token);
  assert.equal(tokenOf.get(one.devices[0]?.sessionId ?? ""), null);
});

test("DeviceNotRegistered tidak menghapus token baru bila sesi sudah mendaftarkan ulang token lain", async () => {
  const st = await studentWithDevices(schoolId, 1);
  const device = st.devices[0];
  assert.ok(device);
  const fresh = expoToken();
  const reRegistering: PushTransport = {
    name: "memory",
    async send(messages) {
      await prisma.authSession.update({ where: { id: device.sessionId }, data: { expoPushToken: fresh } });
      return messages.map(() => ({ status: "error" as const, details: { error: "DeviceNotRegistered" } }));
    },
  };
  const now = new Date();
  await pendingNotification(st.user.id, now);
  const summary = await dispatchPendingPushes(jobCtx(now, [st.user.id]), reRegistering);
  assert.equal(summary.tokensCleared, 0);
  assert.equal((await prisma.authSession.findUniqueOrThrow({ where: { id: device.sessionId } })).expoPushToken, fresh);
});

test("error sementara (HTTP 503): PENDING dengan backoff 1/5/30 menit, FAILED setelah 4 percobaan", async () => {
  const st = await studentWithDevices(schoolId, 1);
  memoryPushTransport.setRequestFailure(() => Object.assign(new Error("Expo sibuk"), { statusCode: 503 }));
  const t0 = new Date();
  const id = await pendingNotification(st.user.id, t0);
  const expected = [
    { at: 0, attempts: 1, next: 1 },
    { at: 1, attempts: 2, next: 6 },
    { at: 6, attempts: 3, next: 36 },
  ];
  for (const step of expected) {
    const early = await dispatchPendingPushes(jobCtx(minutesAfter(t0, step.at - 0.5), [st.user.id]), memoryPushTransport);
    if (step.at > 0) assert.equal(early.claimed, 0, `belum jatuh tempo sebelum menit ${step.at}`);
    const summary = await dispatchPendingPushes(jobCtx(minutesAfter(t0, step.at), [st.user.id]), memoryPushTransport);
    assert.equal(summary.retried, 1, `percobaan ${step.attempts}`);
    const row = await notificationRow(id);
    assert.deepEqual([row.pushStatus, row.pushAttempts, row.pushError], ["PENDING", step.attempts, "HTTP_503"]);
    assert.equal(row.pushNextAttemptAt.getTime(), minutesAfter(t0, step.next).getTime());
  }
  const last = await dispatchPendingPushes(jobCtx(minutesAfter(t0, 36), [st.user.id]), memoryPushTransport);
  assert.equal(last.failed, 1);
  const row = await notificationRow(id);
  assert.deepEqual([row.pushStatus, row.pushAttempts, row.pushError], ["FAILED", 4, "HTTP_503"]);
  assert.equal(messagesFor(id).length, 0);
});

test("MessageRateExceeded -> dicoba ulang; error 4xx permanen -> langsung FAILED", async () => {
  const limited = await studentWithDevices(schoolId, 1);
  memoryPushTransport.setTicketScript(() => ({ status: "error", details: { error: "MessageRateExceeded" } }));
  const now = new Date();
  const limitedId = await pendingNotification(limited.user.id, now);
  await dispatchPendingPushes(jobCtx(now, [limited.user.id]), memoryPushTransport);
  const retried = await notificationRow(limitedId);
  assert.deepEqual([retried.pushStatus, retried.pushError], ["PENDING", "MessageRateExceeded"]);
  memoryPushTransport.reset();
  const rejected = await studentWithDevices(schoolId, 1);
  memoryPushTransport.setRequestFailure(() => Object.assign(new Error("tidak valid"), { statusCode: 400, code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }));
  const rejectedId = await pendingNotification(rejected.user.id, now);
  await dispatchPendingPushes(jobCtx(now, [rejected.user.id]), memoryPushTransport);
  const failed = await notificationRow(rejectedId);
  assert.deepEqual([failed.pushStatus, failed.pushAttempts, failed.pushError], ["FAILED", 1, "HTTP_400:PUSH_TOO_MANY_EXPERIENCE_IDS"]);
});

test("notifikasi > 60 menit -> SKIPPED EXPIRED; penerima tanpa token -> SKIPPED NO_DEVICE; keduanya tidak dikirim", async () => {
  const st = await studentWithDevices(schoolId, 1);
  const noToken = await createStudent(schoolId);
  await createSessionToken(noToken.user.id);
  const now = new Date();
  const oldId = await pendingNotification(st.user.id, minutesAfter(now, -61));
  const noDeviceId = await pendingNotification(noToken.user.id, now);
  const summary = await dispatchPendingPushes(jobCtx(now, [st.user.id, noToken.user.id]), memoryPushTransport);
  assert.deepEqual({ claimed: summary.claimed, expired: summary.expired, skipped: summary.skipped, sent: summary.sent }, { claimed: 2, expired: 1, skipped: 1, sent: 0 });
  const expired = await notificationRow(oldId);
  assert.deepEqual([expired.pushStatus, expired.pushError, expired.pushAttempts], ["SKIPPED", "EXPIRED", 0]);
  const skipped = await notificationRow(noDeviceId);
  assert.deepEqual([skipped.pushStatus, skipped.pushError], ["SKIPPED", "NO_DEVICE"]);
  assert.equal(messagesFor(oldId).length + messagesFor(noDeviceId).length, 0);
});

test("dua dispatcher paralel: setiap notifikasi dikirim tepat sekali", async () => {
  const students = await Promise.all([1, 2, 3].map(() => studentWithDevices(schoolId, 1)));
  const now = new Date();
  const ids: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    for (const st of students) ids.push(await pendingNotification(st.user.id, now));
  }
  const userIds = students.map((s) => s.user.id);
  const [x, y] = await Promise.all([
    dispatchPendingPushes(jobCtx(now, userIds), memoryPushTransport),
    dispatchPendingPushes(jobCtx(now, userIds), memoryPushTransport),
  ]);
  const rows = await prisma.notification.groupBy({ by: ["pushStatus", "pushError"], where: { id: { in: ids } }, _count: true });
  const debug = JSON.stringify({ x, y, rows, sent: memoryPushTransport.sent().length });
  assert.equal(x.sent + y.sent, ids.length, debug);
  assert.equal(x.claimed + y.claimed, ids.length, debug);
  for (const id of ids) assert.equal(messagesFor(id).length, 1, id);
  assert.equal(await prisma.notification.count({ where: { id: { in: ids }, pushStatus: "SENT" } }), ids.length);
});

test("klaim kedaluwarsa diambil alih dispatcher lain: update akhir dispatcher lama tidak menimpa", async () => {
  const st = await studentWithDevices(schoolId, 1);
  const t0 = new Date();
  const id = await pendingNotification(st.user.id, t0);
  let takeover = { sent: -1 };
  const slow: PushTransport = {
    name: "memory",
    async send(messages) {
      // Lease 2 menit habis: dispatcher lain (jam t0 + 3 menit) mengambil alih dan mengirim ulang (at-least-once).
      takeover = await dispatchPendingPushes(jobCtx(minutesAfter(t0, 3), [st.user.id]), memoryPushTransport);
      return messages.map(() => ({ status: "error" as const, details: { error: "MessageTooBig" } }));
    },
  };
  const stale = await dispatchPendingPushes(jobCtx(t0, [st.user.id]), slow);
  assert.equal(takeover.sent, 1);
  assert.deepEqual({ sent: stale.sent, failed: stale.failed }, { sent: 0, failed: 0 }, "hasil lama tidak diterapkan");
  const row = await notificationRow(id);
  assert.deepEqual([row.pushStatus, row.pushError, row.pushAttempts], ["SENT", null, 1]);
});

test("job push-dispatch: menghormati cakupan; cakupan kosong tidak menyentuh apa pun", async () => {
  const st = await studentWithDevices(schoolId, 1);
  const now = new Date();
  const id = await pendingNotification(st.user.id, now);
  const empty = await JOB_HANDLERS["push-dispatch"]({ ...jobCtx(now, []), scope: { userIds: [], schoolIds: [] } });
  assert.equal(empty.claimed, 0);
  assert.equal((await notificationRow(id)).pushStatus, "PENDING");
  const result = await JOB_HANDLERS["push-dispatch"](jobCtx(now, [st.user.id]));
  assert.deepEqual({ claimed: result.claimed, sent: result.sent }, { claimed: 1, sent: 1 });
  assert.equal(messagesFor(id).length, 1, "PUSH_TRANSPORT=memory dipilih dari env");
  const bySchool = await studentWithDevices(schoolId, 1);
  const schoolScoped = await pendingNotification(bySchool.user.id, now);
  await JOB_HANDLERS["push-dispatch"]({ ...jobCtx(now, []), scope: { schoolIds: [schoolId] } });
  assert.equal((await notificationRow(schoolScoped)).pushStatus, "SENT");
});

test("anggaran waktu habis di tengah batch: chunk berikutnya tidak dikirim, barisnya dilepas (jatuh tempo lagi, percobaan tidak bertambah)", async () => {
  const st = await studentWithDevices(schoolId, 1);
  const now = new Date();
  const count = 150;
  await prisma.notification.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      userId: st.user.id, type: "INVOICE_ISSUED" as const, category: "FINANCE" as const, title: `Tagihan anggaran ${i}`, body: "Isi", pushNextAttemptAt: now, createdAt: now,
    })),
  });
  const ids = (await prisma.notification.findMany({ where: { userId: st.user.id }, select: { id: true } })).map((r) => r.id);
  const budgetMs = 1_500;
  const ctx = { ...jobCtx(now, [st.user.id]), deadline: Date.now() + budgetMs };
  let requests = 0;
  const slow: PushTransport = {
    name: "memory",
    async send(messages) {
      requests += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, ctx.deadline - Date.now()) + 100));
      return messages.map((_, i) => ({ status: "ok" as const, id: `slow-${requests}-${i}` }));
    },
  };
  const summary = await dispatchPendingPushes(ctx, slow);
  assert.equal(requests, 1, "chunk kedua tidak dikirim setelah anggaran habis");
  assert.deepEqual({ claimed: summary.claimed, sent: summary.sent, released: summary.released, retried: summary.retried }, { claimed: count, sent: 100, released: 50, retried: 0 });
  const rows = await prisma.notification.findMany({ where: { id: { in: ids } }, select: { pushStatus: true, pushAttempts: true, pushNextAttemptAt: true } });
  const pending = rows.filter((r) => r.pushStatus === "PENDING");
  assert.equal(pending.length, 50);
  assert.ok(pending.every((r) => r.pushAttempts === 0 && r.pushNextAttemptAt.getTime() === now.getTime()), "dilepas: jatuh tempo sekarang, percobaan tidak dipakai");
  const next = await dispatchPendingPushes(jobCtx(now, [st.user.id]), memoryPushTransport);
  assert.deepEqual({ claimed: next.claimed, sent: next.sent }, { claimed: 50, sent: 50 }, "putaran berikutnya mengirim sisanya");
});
