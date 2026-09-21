import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import {
  create,
  createAnnouncementSchool,
  createDraft,
  draftInput,
  getOne,
  list,
  patch,
  preview,
  remove,
  studentIn,
  superAdminToken,
  type AnnouncementBody,
  type SchoolFixture,
} from "./helpers";

after(disconnect);

let a: SchoolFixture;
let b: SchoolFixture;
let saToken: string;

before(async () => {
  [a, b] = await Promise.all([createAnnouncementSchool(), createAnnouncementSchool()]);
  saToken = await superAdminToken();
});

test("buat draf: 201, penulis & target bernama, audit announcement.create", async () => {
  const s1 = await studentIn(a.school.id, a.classA.id);
  const res = await create(a.adminToken, draftInput({ category: "ACADEMIC", title: "  Ujian tengah semester ", audience: "STUDENTS", studentIds: [s1.student.id, s1.student.id] }));
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  const data = res.body!.data;
  assert.equal(data.status, "DRAFT");
  assert.equal(data.title, "Ujian tengah semester");
  assert.equal(data.author.id, a.adminId);
  assert.equal(data.recipientCount, null);
  assert.equal(data.publishedAt, null);
  assert.deepEqual(data.targets.students, [{ id: s1.student.id, name: s1.user.name, nis: s1.student.nis }]);
  assert.deepEqual(data.stats, { recipientCount: 0, readCount: 0 });
  const audit = await prisma.auditLog.findFirst({ where: { entityId: data.id, action: "announcement.create" } });
  assert.equal(audit?.schoolId, a.school.id);
  assert.equal(audit?.actorId, a.adminId);
  assert.equal(await prisma.notification.count({ where: { announcementId: data.id } }), 0, "draf tidak menotifikasi");
});

test("buat: 400 validasi (SYSTEM, judul pendek, kombinasi audiens, field asing)", async () => {
  const cases: Array<Record<string, unknown>> = [
    draftInput({ category: "SYSTEM" }),
    draftInput({ title: "ab" }),
    draftInput({ body: "" }),
    draftInput({ audience: "ALL", classIds: [a.classA.id] }),
    draftInput({ audience: "CLASSES" }),
    draftInput({ audience: "STUDENTS", studentIds: [] }),
    draftInput({ schoolId: a.school.id }),
  ];
  for (const json of cases) {
    const res = await create(a.adminToken, json);
    assert.equal(res.status, 400, JSON.stringify(json));
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
});

test("buat: target sekolah lain / kelas nonaktif / siswa DRAF -> 422 INVALID_TARGETS { invalidIds }", async () => {
  const inactive = await prisma.schoolClass.create({ data: { schoolId: a.school.id, academicYearId: a.classA.academicYearId, name: uniq("X"), gradeLevel: 7, isActive: false } });
  const classes = await create(a.adminToken, draftInput({ audience: "CLASSES", classIds: [a.classA.id, b.classA.id, inactive.id, "tidak-ada"] }));
  assert.equal(classes.status, 422);
  assert.equal(classes.body?.error?.code, "INVALID_TARGETS");
  assert.deepEqual((classes.body?.error?.details as { invalidIds: string[] }).invalidIds, [b.classA.id, inactive.id, "tidak-ada"]);
  const draft = await studentIn(a.school.id, a.classA.id, "DRAFT");
  const foreign = await studentIn(b.school.id, b.classA.id);
  const graduated = await studentIn(a.school.id, null, "GRADUATED");
  const title = `Target salah ${uniq("t")}`;
  const students = await create(a.adminToken, draftInput({ title, audience: "STUDENTS", studentIds: [graduated.student.id, draft.student.id, foreign.student.id] }));
  assert.equal(students.status, 422);
  assert.deepEqual((students.body?.error?.details as { invalidIds: string[] }).invalidIds, [draft.student.id, foreign.student.id]);
  assert.equal(await prisma.announcement.count({ where: { title } }), 0, "tidak ada draf tersimpan");
  const ok = await create(a.adminToken, draftInput({ audience: "STUDENTS", studentIds: [graduated.student.id] }));
  assert.equal(ok.status, 201, "siswa LULUS (non-DRAF) boleh jadi target");
});

test("pratinjau penerima: hanya siswa AKTIF berakun aktif; target asing 422", async () => {
  const fx = await createAnnouncementSchool();
  await studentIn(fx.school.id, fx.classA.id);
  await studentIn(fx.school.id, fx.classA.id);
  await studentIn(fx.school.id, fx.classA.id, "INACTIVE");
  await studentIn(fx.school.id, fx.classA.id, "ACTIVE", false);
  const other = await studentIn(fx.school.id, fx.classB.id);
  await studentIn(fx.school.id, fx.classA.id, "DRAFT");
  const byClass = await preview(fx.adminToken, { audience: "CLASSES", classIds: [fx.classA.id] });
  assert.equal(byClass.status, 200, JSON.stringify(byClass.body?.error));
  assert.equal(byClass.body?.data.count, 2);
  assert.equal((await preview(fx.adminToken, { audience: "ALL" })).body?.data.count, 3);
  assert.equal((await preview(fx.adminToken, { audience: "STUDENTS", studentIds: [other.student.id] })).body?.data.count, 1);
  assert.equal((await preview(fx.adminToken, { audience: "CLASSES", classIds: [b.classA.id] })).body?.error?.code, "INVALID_TARGETS");
  assert.equal((await preview(fx.adminToken, { audience: "CLASSES" })).status, 400);
});

test("daftar: filter status/kategori, q meloloskan wildcard, paginasi & penulis", async () => {
  const fx = await createAnnouncementSchool();
  const tag = uniq("cari");
  await createDraft(fx, { title: `${tag} rapat komite`, category: "EVENT" });
  await createDraft(fx, { title: `${tag} jadwal ujian`, category: "ACADEMIC" });
  await createDraft(fx, { title: "Diskon 50% kantin", category: "FINANCE" });
  const all = await list(fx.adminToken, "limit=2");
  assert.equal(all.status, 200, JSON.stringify(all.body?.error));
  assert.equal(all.body?.data.length, 2);
  assert.deepEqual(all.body?.meta, { total: 3, page: 1, limit: 2, totalPages: 2 });
  assert.equal(all.body?.data[0]?.author.id, fx.adminId);
  assert.equal("body" in (all.body?.data[0] ?? {}), false, "daftar tanpa isi");
  const academic = await list(fx.adminToken, `category=ACADEMIC&q=${encodeURIComponent(tag)}`);
  assert.deepEqual(academic.body?.data.map((r) => r.title), [`${tag} jadwal ujian`]);
  assert.deepEqual((await list(fx.adminToken, "q=%25")).body?.data.map((r) => r.title), ["Diskon 50% kantin"], "q=% hanya cocok judul ber-%");
  assert.equal((await list(fx.adminToken, "q=_")).body?.data.length, 0, "q=_ bukan wildcard satu karakter");
  assert.equal((await list(fx.adminToken, "q=50%25")).body?.data.length, 1);
  assert.equal((await list(fx.adminToken, "status=PUBLISHED")).body?.data.length, 0);
  assert.equal((await list(fx.adminToken, "status=BOGUS")).status, 400);
});

test("detail & ubah draf: ganti audiens mengganti seluruh target; audit announcement.update", async () => {
  const draft = await createDraft(a, { audience: "CLASSES", classIds: [a.classA.id] });
  const s1 = await studentIn(a.school.id, a.classB.id);
  const res = await patch(a.adminToken, draft.id, { title: "Judul diperbarui", audience: "STUDENTS", studentIds: [s1.student.id] });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.title, "Judul diperbarui");
  assert.equal(res.body?.data.audience, "STUDENTS");
  assert.deepEqual(res.body?.data.targets.classes, []);
  assert.deepEqual(res.body?.data.targets.students.map((s) => s.id), [s1.student.id]);
  assert.equal(await prisma.announcementTarget.count({ where: { announcementId: draft.id } }), 1);
  const detail = await getOne(a.adminToken, draft.id);
  assert.equal(detail.body?.data.body, draft.body);
  const onlyBody = await patch(a.adminToken, draft.id, { body: "Isi baru" });
  assert.equal(onlyBody.body?.data.body, "Isi baru");
  assert.equal(onlyBody.body?.data.audience, "STUDENTS", "target lama tetap bila audiens tidak dikirim");
  assert.equal(await prisma.auditLog.count({ where: { entityId: draft.id, action: "announcement.update" } }), 2);
  assert.equal((await patch(a.adminToken, draft.id, { classIds: [a.classA.id] })).status, 400);
  assert.equal((await patch(a.adminToken, draft.id, {})).status, 400);
  const invalid = await patch(a.adminToken, draft.id, { audience: "CLASSES", classIds: [b.classA.id] });
  assert.equal(invalid.body?.error?.code, "INVALID_TARGETS");
});

test("hapus draf: target ikut terhapus; selain draf 409 ANNOUNCEMENT_NOT_DRAFT", async () => {
  const draft = await createDraft(a, { audience: "CLASSES", classIds: [a.classA.id] });
  const res = await remove(a.adminToken, draft.id);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data, { id: draft.id, deleted: true });
  assert.equal(await prisma.announcement.count({ where: { id: draft.id } }), 0);
  assert.equal(await prisma.announcementTarget.count({ where: { announcementId: draft.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { entityId: draft.id, action: "announcement.delete" } }), 1);
  assert.equal((await remove(a.adminToken, draft.id)).status, 404);
  const cancelled = await prisma.announcement.create({
    data: { schoolId: a.school.id, authorId: a.adminId, category: "EVENT", title: "Batal", body: "x", audience: "ALL", status: "CANCELLED", cancelledAt: new Date() },
  });
  const blocked = await remove(a.adminToken, cancelled.id);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body?.error?.code, "ANNOUNCEMENT_NOT_DRAFT");
  const edit = await patch(a.adminToken, cancelled.id, { title: "Judul lain" });
  assert.equal(edit.status, 422);
  assert.equal(edit.body?.error?.code, "ANNOUNCEMENT_NOT_EDITABLE");
});

test("IDOR: admin sekolah lain 404, schoolId asing 403 SCOPE_MISMATCH, super admin wajib ?schoolId", async () => {
  const draft = await createDraft(a);
  assert.equal((await getOne(b.adminToken, draft.id)).status, 404);
  assert.equal((await patch(b.adminToken, draft.id, { title: "Bajak judul" })).status, 404);
  assert.equal((await remove(b.adminToken, draft.id)).status, 404);
  const mismatch = await getOne(a.adminToken, draft.id, b.school.id);
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.body?.error?.code, "SCOPE_MISMATCH");
  assert.equal((await list(a.adminToken, "", b.school.id)).body?.error?.code, "SCOPE_MISMATCH");
  const noScope = await list(saToken);
  assert.equal(noScope.status, 400);
  assert.equal(noScope.body?.error?.code, "SCHOOL_ID_REQUIRED");
  assert.equal((await getOne(saToken, draft.id, a.school.id)).status, 200);
  assert.equal((await getOne(saToken, draft.id, b.school.id)).status, 404);
  const unknownSchool = await list(saToken, "", "sekolah-tidak-ada");
  assert.equal(unknownSchool.status, 404);
  assert.equal(unknownSchool.body?.error?.code, "SCHOOL_NOT_FOUND");
  const saDraft = await create(saToken, draftInput(), a.school.id);
  assert.equal(saDraft.status, 201);
  assert.equal((saDraft.body?.data as AnnouncementBody).status, "DRAFT");
  assert.equal((await prisma.announcement.findFirstOrThrow({ where: { id: saDraft.body!.data.id } })).schoolId, a.school.id);
});

test("gerbang peran: siswa 403 FORBIDDEN", async () => {
  const student = await studentIn(a.school.id, a.classA.id);
  const token = (await createSessionToken(student.user.id)).token;
  const res = await list(token);
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "FORBIDDEN");
  assert.equal((await create(token, draftInput())).status, 403);
});
