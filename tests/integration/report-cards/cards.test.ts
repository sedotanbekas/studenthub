/**
 * Daftar rapor, buat rapor kosong, hapus rapor DRAFT, dan statistik rapor untuk dashboard.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { makePrincipal } from "@/lib/auth/test-principal";
import { reportCardStats } from "@/lib/report-cards/stats";
import { resolveSchoolScope } from "@/lib/tenant/scope";
import { createAcademicYearWithTerm, createStudent } from "../helpers/factories";
import { disconnect, prisma } from "../helpers/db";
import {
  addStudent,
  bulkBody,
  cardIdOf,
  createCard,
  createRcWorld,
  deleteCard,
  gradeAll,
  listCards,
  publish,
  putBulk,
  putCardGrades,
} from "./helpers";

after(disconnect);

test("daftar: default semester aktif, jumlah nilai/mapel & rata-rata, filter, paginasi", async () => {
  const w = await createRcWorld(3);
  const [s0, s1] = w.students.map((s) => s.student.id) as [string, string];
  await gradeAll(w, [s0], 90);
  await putCardGrades(w.adminToken, await cardIdOf(w, s0), [{ subjectId: w.subjects[0].id, score: 85 }, { subjectId: w.subjects[2].id, score: 95 }]);
  await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: s1, score: 70 }]));
  assert.equal((await publish(w.adminToken, { termId: w.term.id, classId: w.klass.id, studentIds: [s0] })).status, 200);

  const res = await listCards(w.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const rows = res.body!.data;
  assert.deepEqual(rows.map((r) => [r.student.id, r.status, r.gradedCount, r.expectedCount, r.average]), [
    [s0, "PUBLISHED", 3, 3, 90], [s1, "DRAFT", 1, 3, 70],
  ]);
  assert.equal(rows[0]?.className, w.klass.name);
  assert.ok(rows[0]?.publishedAt);
  assert.deepEqual(res.body?.meta, { total: 2, page: 1, limit: 20, totalPages: 1 });

  assert.deepEqual((await listCards(w.adminToken, "?status=DRAFT")).body?.data.map((r) => r.student.id), [s1]);
  const name = w.students[1]!.user.name;
  assert.deepEqual((await listCards(w.adminToken, `?q=${encodeURIComponent(name.slice(0, 9))}`)).body?.data.map((r) => r.student.id), [s1]);
  assert.deepEqual((await listCards(w.adminToken, `?q=${encodeURIComponent(w.students[0]!.student.nis)}`)).body?.data.map((r) => r.student.id), [s0]);
  assert.deepEqual((await listCards(w.adminToken, "?q=%25")).body?.data, []);
  assert.deepEqual((await listCards(w.adminToken, `?classId=${w.klass.id}&termId=${w.term.id}`)).body?.data.length, 2);
  const paged = await listCards(w.adminToken, "?limit=1&page=2");
  assert.deepEqual([paged.body?.data.map((r) => r.student.id), paged.body?.meta?.totalPages], [[s1], 2]);
  assert.equal((await listCards(w.adminToken, "?status=DONE")).status, 400);

  await prisma.school.update({ where: { id: w.school.id }, data: { activeTermId: null } });
  assert.deepEqual((await listCards(w.adminToken)).body?.meta, { total: 0, page: 1, limit: 20, totalPages: 0 });
});

test("buat rapor kosong: 201 + audit; sudah ada -> 409; siswa tanpa kelas / nonaktif -> 422; tahun ajaran beda -> 422", async () => {
  const w = await createRcWorld(1);
  const s0 = w.students[0]!.student.id;
  const res = await createCard(w.adminToken, { studentId: s0, termId: w.term.id });
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.deepEqual([res.body?.data.status, res.body?.data.className, res.body?.data.grades, res.body?.data.average], ["DRAFT", w.klass.name, [], null]);
  assert.deepEqual(res.body?.data.missingSubjectIds, w.subjects.map((s) => s.id));
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: res.body!.data.id, action: "report_card.create" } }));
  const dup = await createCard(w.adminToken, { studentId: s0, termId: w.term.id });
  assert.deepEqual([dup.status, dup.body?.error?.code], [409, "REPORT_CARD_EXISTS"]);

  const noClass = await createStudent(w.school.id, { classId: null });
  const inactive = await addStudent(w, { status: "INACTIVE" });
  for (const studentId of [noClass.student.id, inactive.student.id]) {
    const r = await createCard(w.adminToken, { studentId, termId: w.term.id });
    assert.deepEqual([r.status, r.body?.error?.code], [422, "STUDENT_NOT_ELIGIBLE"]);
  }
  const other = await addStudent(w);
  const oldYear = await createAcademicYearWithTerm(w.school.id, {
    name: "2018/2019", yearStart: "2018-07-16", yearEnd: "2019-06-29", termStart: "2018-07-16", termEnd: "2018-12-22", active: false,
  });
  assert.equal((await createCard(w.adminToken, { studentId: other.student.id, termId: oldYear.term.id })).body?.error?.code, "CLASS_TERM_MISMATCH");
  assert.equal((await createCard(w.adminToken, { studentId: "tidak-ada", termId: w.term.id })).status, 404);
  assert.equal((await createCard(w.adminToken, { studentId: other.student.id, termId: "tidak-ada" })).status, 404);
  assert.equal((await createCard(w.adminToken, { studentId: other.student.id })).status, 400);
});

test("hapus rapor: hanya DRAFT (nilai ikut terhapus) + audit; terbit -> 409", async () => {
  const w = await createRcWorld(2);
  const [s0, s1] = w.students.map((s) => s.student.id) as [string, string];
  await gradeAll(w, [s0, s1], 80);
  await publish(w.adminToken, { termId: w.term.id, classId: w.klass.id, studentIds: [s1] });
  const draftId = await cardIdOf(w, s0);
  const res = await deleteCard(w.adminToken, draftId);
  assert.deepEqual([res.status, res.body?.data], [200, { id: draftId }]);
  assert.equal(await prisma.reportCard.count({ where: { id: draftId } }), 0);
  assert.equal(await prisma.reportCardGrade.count({ where: { reportCardId: draftId } }), 0);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: draftId, action: "report_card.delete" } }));
  assert.equal((await deleteCard(w.adminToken, draftId)).status, 404);
  const published = await deleteCard(w.adminToken, await cardIdOf(w, s1));
  assert.deepEqual([published.status, published.body?.error?.code], [409, "REPORT_CARD_PUBLISHED"]);
});

test("reportCardStats: corong siswa aktif (nilai >= 1, lengkap, terbit) + term aktif / termId", async () => {
  const w = await createRcWorld(4);
  const [s0, s1, s2] = w.students.map((s) => s.student.id) as [string, string, string];
  const gone = await addStudent(w);
  await gradeAll(w, [s0, s1, gone.student.id], 80);
  await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: s2, score: 60 }]));
  await publish(w.adminToken, { termId: w.term.id, classId: w.klass.id, studentIds: [s0] });
  await prisma.student.update({ where: { id: gone.student.id }, data: { status: "MOVED", activeNisn: null } });
  const scope = resolveSchoolScope(makePrincipal({ schoolId: w.school.id }));
  const stats = await reportCardStats(scope);
  assert.deepEqual(stats, {
    term: { id: w.term.id, label: `Semester Ganjil ${(await prisma.academicYear.findUniqueOrThrow({ where: { id: w.academicYearId } })).name}` },
    activeStudents: 4,
    studentsWithGrades: 3,
    studentsComplete: 2,
    published: 1,
  });
  assert.deepEqual(await reportCardStats(scope, { termId: w.term.id }), stats);
  await prisma.school.update({ where: { id: w.school.id }, data: { activeTermId: null } });
  assert.deepEqual(await reportCardStats(scope), { term: null, activeStudents: 4, studentsWithGrades: 0, studentsComplete: 0, published: 0 });
  await assert.rejects(reportCardStats(scope, { termId: "tidak-ada" }), (e: { status?: number }) => e.status === 404);
});
