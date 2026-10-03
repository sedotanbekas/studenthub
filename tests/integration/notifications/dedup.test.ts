/**
 * Kunci dedup notifikasi job (N4): (userId, dedupKey) unik + INSERT IGNORE -> panggilan ulang tidak menggandakan;
 * kunci berbeda / tanpa kunci tetap menulis; kunci > 64 karakter ditolak (bukan dipotong diam-diam).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { notifyUsers, type NotificationEvent } from "@/lib/notifications/notify";
import { NOTIFICATION_DEDUP_KEY_MAX } from "@/lib/notifications/rules";
import { withTx } from "@/lib/tx";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createStudent } from "../helpers/factories";

after(disconnect);

const event = (dedupKey?: string): NotificationEvent => ({
  type: "ATTENDANCE_ALPHA",
  title: "Alpa pada Selasa, 18 Maret",
  body: "Kamu tercatat Alpa.",
  link: { screen: "attendance-alpha", id: "2031-03-18" },
  ...(dedupKey === undefined ? {} : { dedupKey }),
});

const send = (userIds: readonly string[], e: NotificationEvent) => withTx((tx) => notifyUsers(tx, userIds, e, { now: new Date() }));

test("kunci sama -> satu baris per penerima (hitungan created hanya baris baru); kunci beda & tanpa kunci -> baris baru", async () => {
  const school = await createSchool();
  const [a, b] = [await createStudent(school.id), await createStudent(school.id)];
  const count = () => prisma.notification.count({ where: { userId: a.user.id } });

  assert.equal(await send([a.user.id], event("attendance-alpha:2031-03-18")), 1);
  assert.equal(await send([a.user.id, b.user.id], event("attendance-alpha:2031-03-18")), 1, "a sudah punya kunci ini; hanya b yang baru");
  assert.equal(await count(), 1);
  assert.equal(await send([a.user.id], event("attendance-alpha:2031-03-19")), 1);
  assert.equal(await count(), 2);
  assert.equal(await send([a.user.id], event()), 1);
  assert.equal(await send([a.user.id], event()), 1, "tanpa kunci = perilaku lama (tanpa dedup)");
  assert.equal(await count(), 4);
});

test("kunci > 64 karakter ditolak sebelum menulis apa pun", async () => {
  const school = await createSchool();
  const a = await createStudent(school.id);
  await assert.rejects(send([a.user.id], event("x".repeat(NOTIFICATION_DEDUP_KEY_MAX + 1))), RangeError);
  assert.equal(await prisma.notification.count({ where: { userId: a.user.id } }), 0);
});
