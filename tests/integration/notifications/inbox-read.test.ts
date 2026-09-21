import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as getDetail } from "@/app/api/v1/notifications/[id]/route";
import { POST as markRead } from "@/app/api/v1/notifications/[id]/read/route";
import { POST as readAll } from "@/app/api/v1/notifications/read-all/route";
import { GET as unreadCount } from "@/app/api/v1/notifications/unread-count/route";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { instantAt, notifyAnnouncement, notifyPersonal, type InboxItemBody } from "./fixtures";

after(disconnect);

type DetailBody = InboxItemBody & {
  announcement: { id: string; category: string; title: string; body: string; publishedAt: string | null } | null;
};
type UnreadBody = { total: number; announcements: number; personal: number; latestCreatedAt: string | null };

const BASE = new Date(Date.now() - 3 * 3_600_000);
let schoolAId = "";
let schoolBId = "";
let adminAId = "";

before(async () => {
  schoolAId = (await createSchool()).id;
  schoolBId = (await createSchool({ timezone: "WIT", provinceCode: "91", cityCode: "91.71" })).id;
  adminAId = (await createSchoolAdmin(schoolAId)).id;
});

async function studentSession(schoolId: string): Promise<{ userId: string; token: string }> {
  const { user } = await createStudent(schoolId);
  const { token } = await createSessionToken(user.id);
  return { userId: user.id, token };
}

const detail = (token: string, id: string) =>
  callRoute<Envelope<DetailBody>>(getDetail, { method: "GET", url: `/api/v1/notifications/${id}`, bearer: token, params: { id } });
const read = (token: string, id: string) =>
  callRoute<Envelope<{ id: string; readAt: string }>>(markRead, { method: "POST", url: `/api/v1/notifications/${id}/read`, bearer: token, params: { id } });
const counts = (token: string) =>
  callRoute<Envelope<UnreadBody>>(unreadCount, { method: "GET", url: "/api/v1/notifications/unread-count", bearer: token });
const readAllCall = (token: string, json: unknown) =>
  callRoute<Envelope<{ updated: number }>>(readAll, { method: "POST", url: "/api/v1/notifications/read-all", bearer: token, json });

test("GET /notifications/{id}: pengumuman berisi isi lengkap; personal announcement=null; tidak menandai dibaca", async () => {
  const me = await studentSession(schoolAId);
  const ann = await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 1), "CALENDAR");
  const res = await detail(me.token, ann.notificationId);
  assert.equal(res.status, 200);
  const stored = await prisma.announcement.findFirstOrThrow({ where: { id: ann.announcementId, schoolId: schoolAId } });
  assert.deepEqual(res.body?.data.announcement, {
    id: ann.announcementId,
    category: "CALENDAR",
    title: stored.title,
    body: stored.body,
    publishedAt: instantAt(BASE, 1).toISOString(),
  });
  assert.equal(res.body?.data.readAt, null);
  const personalId = await notifyPersonal(me.userId, instantAt(BASE, 2));
  const personal = await detail(me.token, personalId);
  assert.equal(personal.status, 200);
  assert.equal(personal.body?.data.announcement, null);
  assert.equal(personal.body?.data.type, "INVOICE_ISSUED");
});

test("GET detail: milik pengguna lain (sekolah lain/sekolah sama) atau tak ada -> 404; id rusak -> 400", async () => {
  const me = await studentSession(schoolAId);
  const otherSchool = await studentSession(schoolBId);
  const sameSchool = await studentSession(schoolAId);
  for (const ownerId of [otherSchool.userId, sameSchool.userId]) {
    const foreign = await notifyPersonal(ownerId, instantAt(BASE, 1));
    const res = await detail(me.token, foreign);
    assert.equal(res.status, 404);
    assert.equal(res.body?.error?.code, "NOT_FOUND");
  }
  assert.equal((await detail(me.token, "tidakada123")).status, 404);
  const bad = await detail(me.token, "id%20rusak");
  assert.equal(bad.status, 400);
});

test("GET detail: pengumuman yang ditarik (CANCELLED) -> 404", async () => {
  const me = await studentSession(schoolAId);
  const ann = await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 1));
  await prisma.announcement.update({ where: { id: ann.announcementId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  const res = await detail(me.token, ann.notificationId);
  assert.equal(res.status, 404);
});

test("POST /notifications/{id}/read: idempoten; milik orang lain/tak ada -> 404", async () => {
  const me = await studentSession(schoolAId);
  const other = await studentSession(schoolBId);
  const id = await notifyPersonal(me.userId, instantAt(BASE, 1));
  const first = await read(me.token, id);
  assert.equal(first.status, 200);
  assert.equal(first.body?.data.id, id);
  const readAt = first.body?.data.readAt;
  assert.ok(readAt);
  const again = await read(me.token, id);
  assert.equal(again.status, 200);
  assert.equal(again.body?.data.readAt, readAt);
  const stored = await prisma.notification.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.readAt?.toISOString(), readAt);

  const foreign = await notifyPersonal(other.userId, instantAt(BASE, 1));
  const denied = await read(me.token, foreign);
  assert.equal(denied.status, 404);
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: foreign } })).readAt, null);
  assert.equal((await read(me.token, "tidakada123")).status, 404);
});

test("GET /notifications/unread-count: total, pengumuman vs personal, createdAt terbaru", async () => {
  const me = await studentSession(schoolAId);
  const empty = await counts(me.token);
  assert.deepEqual(empty.body?.data, { total: 0, announcements: 0, personal: 0, latestCreatedAt: null });
  const ann1 = await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 1));
  await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 2));
  const p1 = await notifyPersonal(me.userId, instantAt(BASE, 3), { type: "PAYMENT_APPROVED" });
  await notifyPersonal(me.userId, instantAt(BASE, 4), { type: "REPORT_CARD_PUBLISHED" });
  await notifyPersonal(me.userId, instantAt(BASE, 5), { type: "LEAVE_REJECTED" });
  const res = await counts(me.token);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data, { total: 5, announcements: 2, personal: 3, latestCreatedAt: instantAt(BASE, 5).toISOString() });
  await read(me.token, ann1.notificationId);
  await read(me.token, p1);
  const after2 = await counts(me.token);
  assert.deepEqual(after2.body?.data, { total: 3, announcements: 1, personal: 2, latestCreatedAt: instantAt(BASE, 5).toISOString() });
});

test("POST /notifications/read-all: batas before, filter kind, jumlah updated", async () => {
  const me = await studentSession(schoolAId);
  const other = await studentSession(schoolAId);
  const otherId = await notifyPersonal(other.userId, instantAt(BASE, 1));
  const ann = await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 1));
  const p1 = await notifyPersonal(me.userId, instantAt(BASE, 2));
  const p2 = await notifyPersonal(me.userId, instantAt(BASE, 10));

  const onlyAnnouncements = await readAllCall(me.token, { kind: "announcement" });
  assert.equal(onlyAnnouncements.status, 200);
  assert.deepEqual(onlyAnnouncements.body?.data, { updated: 1 });
  const bounded = await readAllCall(me.token, { before: instantAt(BASE, 5).toISOString() });
  assert.deepEqual(bounded.body?.data, { updated: 1 });
  const readMap = async (ids: string[]) =>
    (await prisma.notification.findMany({ where: { id: { in: ids } }, select: { id: true, readAt: true } })).reduce<Record<string, boolean>>(
      (acc, row) => ({ ...acc, [row.id]: row.readAt !== null }),
      {},
    );
  assert.deepEqual(await readMap([ann.notificationId, p1, p2, otherId]), { [ann.notificationId]: true, [p1]: true, [p2]: false, [otherId]: false });
  const rest = await readAllCall(me.token, {});
  assert.deepEqual(rest.body?.data, { updated: 1 });
  const none = await readAllCall(me.token, {});
  assert.deepEqual(none.body?.data, { updated: 0 });
  assert.equal((await counts(me.token)).body?.data.total, 0);
});

test("POST read-all: before di masa depan dibatasi ke sekarang (item yang datang belakangan tetap belum dibaca)", async () => {
  const me = await studentSession(schoolAId);
  await notifyPersonal(me.userId, instantAt(BASE, 1));
  const future = await notifyPersonal(me.userId, new Date(Date.now() + 3_600_000));
  const res = await readAllCall(me.token, { before: new Date(Date.now() + 86_400_000).toISOString() });
  assert.deepEqual(res.body?.data, { updated: 1 });
  assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: future } })).readAt, null);
});

test("POST read-all: validasi body -> 400; wajib ganti kata sandi -> 403", async () => {
  const me = await studentSession(schoolAId);
  for (const json of [{ semua: true }, { before: "kemarin" }, { before: "2026-09-21" }, { kind: "semua" }, []]) {
    const res = await readAllCall(me.token, json);
    assert.equal(res.status, 400, JSON.stringify(json));
  }
  const { user } = await createStudent(schoolAId, { mustChangePassword: true });
  const { token } = await createSessionToken(user.id);
  for (const res of [await readAllCall(token, {}), await counts(token), await read(token, "abc123"), await detail(token, "abc123")]) {
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
  }
});
