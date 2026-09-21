import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as listInbox } from "@/app/api/v1/notifications/route";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSponsor, createStudent, createSuperAdmin } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { instantAt, notifyAnnouncement, notifyPersonal, type CursorMetaBody, type InboxItemBody } from "./fixtures";

after(disconnect);

const BASE = new Date(Date.now() - 3 * 3_600_000);
let schoolAId = "";
let adminAId = "";
let schoolBId = "";

before(async () => {
  const schoolA = await createSchool();
  const schoolB = await createSchool({ timezone: "WIT", provinceCode: "91", cityCode: "91.71" });
  schoolAId = schoolA.id;
  schoolBId = schoolB.id;
  adminAId = (await createSchoolAdmin(schoolA.id)).id;
});

async function studentSession(schoolId: string): Promise<{ userId: string; token: string }> {
  const { user } = await createStudent(schoolId);
  const { token } = await createSessionToken(user.id);
  return { userId: user.id, token };
}

function list(token: string, query = "") {
  return callRoute<Envelope<InboxItemBody[]>>(listInbox, { method: "GET", url: `/api/v1/notifications${query}`, bearer: token });
}

async function dbOrder(userId: string): Promise<string[]> {
  const rows = await prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
  return rows.map((r) => r.id);
}

test("GET /notifications: kind all/announcement/personal + kategori + meta cursor", async () => {
  const me = await studentSession(schoolAId);
  const ann1 = await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 1), "EVENT");
  const p1 = await notifyPersonal(me.userId, instantAt(BASE, 2), { type: "INVOICE_ISSUED" });
  const p2 = await notifyPersonal(me.userId, instantAt(BASE, 3), { type: "LEAVE_APPROVED" });
  const ann2 = await notifyAnnouncement(schoolAId, adminAId, me.userId, instantAt(BASE, 4), "ACADEMIC");

  const all = await list(me.token);
  assert.equal(all.status, 200);
  assert.deepEqual(all.body?.data.map((i) => i.id), [ann2.notificationId, p2, p1, ann1.notificationId]);
  assert.deepEqual(all.body?.meta, { limit: 20, nextCursor: null, hasMore: false });
  const first = all.body?.data[0];
  assert.equal(first?.type, "ANNOUNCEMENT");
  assert.equal(first?.category, "ACADEMIC");
  assert.equal(first?.announcementId, ann2.announcementId);
  assert.deepEqual(first?.data, { screen: "announcement", id: ann2.announcementId });
  assert.equal(first?.readAt, null);
  assert.equal(first?.createdAt, instantAt(BASE, 4).toISOString());

  const announcements = await list(me.token, "?kind=announcement");
  assert.deepEqual(announcements.body?.data.map((i) => i.id), [ann2.notificationId, ann1.notificationId]);
  const personal = await list(me.token, "?kind=personal");
  assert.deepEqual(personal.body?.data.map((i) => i.id), [p2, p1]);
  const finance = await list(me.token, "?category=FINANCE");
  assert.deepEqual(finance.body?.data.map((i) => i.id), [p1]);
  const academicPersonal = await list(me.token, "?kind=personal&category=ACADEMIC");
  assert.deepEqual(academicPersonal.body?.data, []);
});

test("GET /notifications?unreadOnly=true menyembunyikan item yang sudah dibaca", async () => {
  const me = await studentSession(schoolAId);
  const p1 = await notifyPersonal(me.userId, instantAt(BASE, 1));
  const p2 = await notifyPersonal(me.userId, instantAt(BASE, 2));
  await prisma.notification.update({ where: { id: p1 }, data: { readAt: instantAt(BASE, 10) } });
  const unread = await list(me.token, "?unreadOnly=true");
  assert.deepEqual(unread.body?.data.map((i) => i.id), [p2]);
  const everything = await list(me.token, "?unreadOnly=false");
  assert.deepEqual(everything.body?.data.map((i) => i.id), [p2, p1]);
  assert.equal(everything.body?.data[1]?.readAt, instantAt(BASE, 10).toISOString());
});

test("cursor stabil: item baru saat paging tidak menggandakan/menghilangkan item; seri createdAt sama", async () => {
  const me = await studentSession(schoolAId);
  await notifyPersonal(me.userId, instantAt(BASE, 5));
  await notifyPersonal(me.userId, instantAt(BASE, 6));
  for (let i = 0; i < 3; i += 1) await notifyPersonal(me.userId, instantAt(BASE, 10));
  const expected = await dbOrder(me.userId);
  assert.equal(expected.length, 5);

  const page1 = await list(me.token, "?limit=2");
  assert.equal(page1.status, 200);
  const meta1 = page1.body?.meta as CursorMetaBody | undefined;
  assert.equal(meta1?.hasMore, true);
  assert.ok(meta1?.nextCursor);
  await notifyPersonal(me.userId, instantAt(BASE, 100));
  await notifyPersonal(me.userId, instantAt(BASE, 100));

  const page2 = await list(me.token, `?limit=2&cursor=${meta1?.nextCursor ?? ""}`);
  const meta2 = page2.body?.meta as CursorMetaBody | undefined;
  assert.equal(meta2?.hasMore, true);
  const page3 = await list(me.token, `?limit=2&cursor=${meta2?.nextCursor ?? ""}`);
  const meta3 = page3.body?.meta as CursorMetaBody | undefined;
  assert.deepEqual(meta3, { limit: 2, nextCursor: null, hasMore: false });

  const seen = [...(page1.body?.data ?? []), ...(page2.body?.data ?? []), ...(page3.body?.data ?? [])].map((i) => i.id);
  assert.deepEqual(seen, expected);
  const fresh = await list(me.token, "?limit=2");
  assert.equal(fresh.body?.data[0]?.createdAt, instantAt(BASE, 100).toISOString());
});

test("validasi query -> 400", async () => {
  const me = await studentSession(schoolAId);
  const cases: Array<[string, string]> = [
    [`?cursor=${"a".repeat(201)}`, "VALIDATION_FAILED"],
    ["?cursor=bukan-cursor!", "INVALID_CURSOR"],
    ["?cursor=eyJ0IjoieCJ9", "INVALID_CURSOR"],
    ["?limit=0", "VALIDATION_FAILED"],
    ["?limit=51", "VALIDATION_FAILED"],
    ["?kind=semua", "VALIDATION_FAILED"],
    ["?unreadOnly=ya", "VALIDATION_FAILED"],
    ["?category=LAINNYA", "VALIDATION_FAILED"],
  ];
  for (const [query, code] of cases) {
    const res = await list(me.token, query);
    assert.equal(res.status, 400, query);
    assert.equal(res.body?.error?.code, code, query);
  }
});

test("tanpa token -> 401; wajib ganti kata sandi -> 403 PASSWORD_CHANGE_REQUIRED", async () => {
  const anon = await callRoute(listInbox, { method: "GET", url: "/api/v1/notifications" });
  assert.equal(anon.status, 401);
  const { user } = await createStudent(schoolAId, { mustChangePassword: true });
  const { token } = await createSessionToken(user.id);
  const res = await list(token);
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
});

test("semua peran membaca inbox sendiri: super admin, admin sekolah, sponsor PENDING, siswa GRADUATED", async () => {
  const sa = await createSuperAdmin();
  const admin = await createSchoolAdmin(schoolBId);
  const sponsor = await createSponsor({ status: "PENDING" });
  const graduated = await createStudent(schoolBId, { status: "GRADUATED" });
  for (const userId of [sa.id, admin.id, sponsor.user.id, graduated.user.id]) {
    const id = await notifyPersonal(userId, instantAt(BASE, 1), { type: "NISN_RELEASED" });
    const { token } = await createSessionToken(userId, { platform: "WEB", deviceId: null });
    const res = await list(token);
    assert.equal(res.status, 200, userId);
    assert.deepEqual(res.body?.data.map((i) => i.id), [id]);
  }
});

test("IDOR: hanya baris milik sendiri; ?schoolId sekolah lain diabaikan", async () => {
  const mine = await studentSession(schoolAId);
  const other = await studentSession(schoolBId);
  const myId = await notifyPersonal(mine.userId, instantAt(BASE, 1));
  await notifyPersonal(other.userId, instantAt(BASE, 2));
  await notifyAnnouncement(schoolAId, adminAId, (await createStudent(schoolAId)).user.id, instantAt(BASE, 3));
  const res = await list(mine.token, `?schoolId=${schoolBId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body?.data.map((i) => i.id), [myId]);
});
