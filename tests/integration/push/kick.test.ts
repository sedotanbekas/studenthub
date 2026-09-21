/**
 * Kick setelah respons: notify -> ctx.defer(kickPushDispatch). DEFER_MODE=inline (setup test) menjalankan
 * pekerjaan defer langsung. Dispatcher terdaftar saat modul job push-dispatch dimuat. Putaran kick di
 * produksi tanpa cakupan; di sini dibatasi ke user milik test (setKickScopeForTests) karena DB uji dipakai
 * bersama proses test lain.
 */
import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { kickPushDispatch } from "@/lib/push/kick";
import { kickContext, runPushDispatch, setKickScopeForTests } from "@/lib/push/runner";
import { memoryPushTransport } from "@/lib/push/transports/memory";
import { createAnnouncementSchool, createDraft, publish } from "../announcements/helpers";
import { disconnect, prisma } from "../helpers/db";
import { addDevice, jobCtx, messagesFor, notificationRow, pendingNotification, studentWithDevices } from "./helpers";

after(disconnect);
afterEach(() => {
  memoryPushTransport.reset();
  setKickScopeForTests(undefined);
});

test("sebelum modul job dimuat, kick tidak melakukan apa pun (notifikasi tetap PENDING)", async () => {
  const fx = await createAnnouncementSchool();
  const st = await studentWithDevices(fx.school.id, 1);
  const id = await pendingNotification(st.user.id);
  await kickPushDispatch();
  assert.equal((await notificationRow(id)).pushStatus, "PENDING");
  assert.equal(messagesFor(id).length, 0);
});

test("setelah terdaftar: terbitkan pengumuman -> push terkirim segera setelah respons", async () => {
  await import("@/lib/jobs/push-dispatch");
  const fx = await createAnnouncementSchool();
  const st = await studentWithDevices(fx.school.id, 0);
  await prisma.student.update({ where: { id: st.student.id }, data: { currentClassId: fx.classA.id } });
  const device = await addDevice(st.user.id);
  setKickScopeForTests({ userIds: [st.user.id] });
  const draft = await createDraft(fx, { audience: "CLASSES", classIds: [fx.classA.id] });
  const res = await publish(fx.adminToken, draft.id);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const note = await prisma.notification.findFirstOrThrow({ where: { announcementId: draft.id, userId: st.user.id } });
  assert.equal(note.pushStatus, "SENT");
  const [message] = messagesFor(note.id);
  assert.equal(message?.to, device.token);
  assert.deepEqual(message?.data, { notificationId: note.id, screen: "announcement", id: draft.id });
  assert.equal(message?.title, draft.title);
});

test("konteks kick: tanpa cakupan di luar test; cakupan test hanya bila diset", () => {
  assert.equal(kickContext().scope, undefined);
  setKickScopeForTests({ userIds: ["u1"] });
  assert.deepEqual(kickContext().scope, { userIds: ["u1"] });
  const ctx = kickContext();
  assert.ok(ctx.deadline - ctx.now.getTime() <= 40_000);
});

test("mutex: panggilan runPushDispatch saat putaran berjalan berbagi promise yang sama", async () => {
  const st = await studentWithDevices((await createAnnouncementSchool()).school.id, 1);
  const id = await pendingNotification(st.user.id);
  const now = new Date();
  const first = runPushDispatch(() => jobCtx(now, [st.user.id]));
  const second = runPushDispatch(() => jobCtx(now, [st.user.id]));
  assert.equal(first, second);
  const summary = await first;
  assert.equal(summary.sent, 1, "putaran pertama mengirim; putaran ulang tidak menemukan apa pun");
  assert.equal(messagesFor(id).length, 1);
});
