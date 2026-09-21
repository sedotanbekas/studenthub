import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { disconnect, prisma, uniq } from "../helpers/db";
import {
  cancel,
  create,
  createAnnouncementSchool,
  createDraft,
  draftInput,
  getOne,
  patch,
  publish,
  studentIn,
  type SchoolFixture,
} from "./helpers";

after(disconnect);

let a: SchoolFixture;
let b: SchoolFixture;

before(async () => {
  [a, b] = await Promise.all([createAnnouncementSchool(), createAnnouncementSchool()]);
});

const recipientsOf = async (announcementId: string) =>
  (await prisma.notification.findMany({ where: { announcementId }, select: { userId: true } })).map((n) => n.userId).sort();

test("terbit ke kelas: hanya siswa AKTIF berakun aktif di kelas itu; sekolah lain tidak pernah", async () => {
  const x1 = await studentIn(a.school.id, a.classA.id);
  const x2 = await studentIn(a.school.id, a.classA.id);
  await studentIn(a.school.id, a.classA.id, "INACTIVE");
  await studentIn(a.school.id, a.classA.id, "GRADUATED");
  await studentIn(a.school.id, a.classA.id, "ACTIVE", false);
  await studentIn(a.school.id, a.classB.id);
  await studentIn(b.school.id, b.classA.id);
  const draft = await createDraft(a, { category: "ACADEMIC", audience: "CLASSES", classIds: [a.classA.id] });
  const res = await publish(a.adminToken, draft.id);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const data = res.body!.data;
  assert.equal(data.status, "PUBLISHED");
  assert.equal(data.recipientCount, 2);
  assert.ok(data.publishedAt);
  assert.deepEqual(data.stats, { recipientCount: 2, readCount: 0 });
  assert.deepEqual(await recipientsOf(draft.id), [x1.user.id, x2.user.id].sort());
  const note = await prisma.notification.findFirstOrThrow({ where: { announcementId: draft.id, userId: x1.user.id } });
  assert.equal(note.type, "ANNOUNCEMENT");
  assert.equal(note.category, "ACADEMIC");
  assert.equal(note.title, draft.title);
  assert.deepEqual(note.data, { screen: "announcement", id: draft.id });
  assert.equal(note.pushStatus, "PENDING", "siswa -> outbox push");
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: draft.id, action: "announcement.publish" } });
  assert.equal((audit.after as { recipientCount: number }).recipientCount, 2);
});

test("terbit ALL: semua siswa aktif sekolah itu saja; STUDENTS: hanya target yang AKTIF", async () => {
  const fx = await createAnnouncementSchool();
  const s1 = await studentIn(fx.school.id, fx.classA.id);
  const s2 = await studentIn(fx.school.id, null);
  const inactive = await studentIn(fx.school.id, fx.classB.id, "INACTIVE");
  const foreign = await studentIn(b.school.id, b.classA.id);
  const all = await create(fx.adminToken, draftInput({ publishNow: true }));
  assert.equal(all.status, 201, JSON.stringify(all.body?.error));
  assert.equal(all.body?.data.status, "PUBLISHED");
  assert.deepEqual(await recipientsOf(all.body!.data.id), [s1.user.id, s2.user.id].sort());
  const picked = await createDraft(fx, { audience: "STUDENTS", studentIds: [s2.student.id, inactive.student.id] });
  const res = await publish(fx.adminToken, picked.id);
  assert.equal(res.body?.data.recipientCount, 1);
  assert.deepEqual(await recipientsOf(picked.id), [s2.user.id]);
  assert.equal(await prisma.notification.count({ where: { userId: foreign.user.id, type: "ANNOUNCEMENT" } }), 0);
});

test("0 penerima -> 422 NO_RECIPIENTS: draf tetap DRAF; publishNow tidak menyimpan draf", async () => {
  const fx = await createAnnouncementSchool();
  const draft = await createDraft(fx, { audience: "CLASSES", classIds: [fx.classB.id] });
  const res = await publish(fx.adminToken, draft.id);
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "NO_RECIPIENTS");
  assert.equal((await prisma.announcement.findFirstOrThrow({ where: { id: draft.id } })).status, "DRAFT");
  const title = `Kosong ${uniq("k")}`;
  const now = await create(fx.adminToken, draftInput({ title, publishNow: true }));
  assert.equal(now.status, 422);
  assert.equal(now.body?.error?.code, "NO_RECIPIENTS");
  assert.equal(await prisma.announcement.count({ where: { title } }), 0, "transaksi dibatalkan seluruhnya");
});

test("terbit ulang / terbit yang dibatalkan -> 409 INVALID_STATUS_TRANSITION", async () => {
  await studentIn(a.school.id, a.classA.id);
  const draft = await createDraft(a);
  assert.equal((await publish(a.adminToken, draft.id)).status, 200);
  const again = await publish(a.adminToken, draft.id);
  assert.equal(again.status, 409);
  assert.equal(again.body?.error?.code, "INVALID_STATUS_TRANSITION");
  const edit = await patch(a.adminToken, draft.id, { title: "Ubah setelah terbit" });
  assert.equal(edit.status, 422);
  assert.equal(edit.body?.error?.code, "ANNOUNCEMENT_NOT_EDITABLE");
});

test("terbit bersamaan: tepat satu berhasil, fan-out sekali", async () => {
  const fx = await createAnnouncementSchool();
  const students = await Promise.all([1, 2, 3].map(() => studentIn(fx.school.id, fx.classA.id)));
  const draft = await createDraft(fx);
  const results = await Promise.all([publish(fx.adminToken, draft.id), publish(fx.adminToken, draft.id), publish(fx.adminToken, draft.id)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409], JSON.stringify(results.map((r) => r.body?.error)));
  assert.equal(await prisma.notification.count({ where: { announcementId: draft.id } }), students.length);
  assert.equal(await prisma.auditLog.count({ where: { entityId: draft.id, action: "announcement.publish" } }), 1);
});

test("tarik pengumuman terbit: CANCELLED + cancelledAt, notifikasi dihapus, audit beralasan", async () => {
  const fx = await createAnnouncementSchool();
  const s1 = await studentIn(fx.school.id, fx.classA.id);
  await studentIn(fx.school.id, fx.classA.id);
  const draft = await createDraft(fx);
  await publish(fx.adminToken, draft.id);
  await prisma.notification.updateMany({ where: { announcementId: draft.id, userId: s1.user.id }, data: { readAt: new Date() } });
  assert.deepEqual((await getOne(fx.adminToken, draft.id)).body?.data.stats, { recipientCount: 2, readCount: 1 });
  const res = await cancel(fx.adminToken, draft.id, { reason: "Salah tanggal" });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.status, "CANCELLED");
  assert.ok(res.body?.data.cancelledAt);
  assert.ok(res.body?.data.publishedAt, "publishedAt dipertahankan (penanda ditarik setelah terbit)");
  assert.deepEqual(res.body?.data.stats, { recipientCount: 2, readCount: 0 });
  assert.equal(await prisma.notification.count({ where: { announcementId: draft.id } }), 0);
  const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: draft.id, action: "announcement.retract" } });
  assert.deepEqual(audit.after, { status: "CANCELLED", reason: "Salah tanggal", removedNotifications: 2 });
  const twice = await cancel(fx.adminToken, draft.id);
  assert.equal(twice.status, 409);
  assert.equal(twice.body?.error?.code, "INVALID_STATUS_TRANSITION");
  assert.equal((await publish(fx.adminToken, draft.id)).status, 409);
});

test("batalkan draf: CANCELLED tanpa notifikasi; alasan terlalu panjang 400", async () => {
  const draft = await createDraft(a);
  assert.equal((await cancel(a.adminToken, draft.id, { reason: "x".repeat(256) })).status, 400);
  const res = await cancel(a.adminToken, draft.id);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.status, "CANCELLED");
  assert.equal(res.body?.data.publishedAt, null);
  assert.equal(await prisma.notification.count({ where: { announcementId: draft.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { entityId: draft.id, action: "announcement.cancel" } }), 1);
});

test("IDOR terbit/tarik: admin sekolah lain 404, tanpa efek", async () => {
  await studentIn(a.school.id, a.classA.id);
  const draft = await createDraft(a);
  assert.equal((await publish(b.adminToken, draft.id)).status, 404);
  assert.equal((await cancel(b.adminToken, draft.id)).status, 404);
  assert.equal((await publish(a.adminToken, draft.id, b.school.id)).body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await prisma.announcement.findFirstOrThrow({ where: { id: draft.id } })).status, "DRAFT");
});
