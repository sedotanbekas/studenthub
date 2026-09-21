/**
 * Input nilai rapor: massal per kelas & mapel (semua-atau-tidak, lazy create, predikat, hapus via null),
 * rapor terbit memblokir, grid nilai, dan input nilai satu rapor.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createAcademicYearWithTerm, createClass, createStudent } from "../helpers/factories";
import { disconnect, prisma, uniq } from "../helpers/db";
import {
  addStudent,
  bulkBody,
  cardIdOf,
  createRcWorld,
  createSubject,
  getSheet,
  gradeAll,
  publish,
  putBulk,
  putCardGrades,
  termQuery,
} from "./helpers";

after(disconnect);

test("input massal: rapor DRAFT dibuat otomatis (snapshot kelas), predikat K13, audit, idempoten", async () => {
  const w = await createRcWorld(3);
  const [s0, s1, s2] = w.students.map((s) => s.student.id) as [string, string, string];
  const res = await putBulk(w.adminToken, bulkBody(w, 1, [
    { studentId: s0, score: 92 },
    { studentId: s1, score: 84, description: "  Baik   sekali " },
    { studentId: s2, score: 74 },
  ]));
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data, { updated: 3, unchanged: 0, deleted: 0, createdReportCards: 3 });
  const cards = await prisma.reportCard.findMany({ where: { termId: w.term.id, classId: w.klass.id }, include: { grades: true } });
  assert.equal(cards.length, 3);
  assert.ok(cards.every((c) => c.status === "DRAFT" && c.classNameSnapshot === w.klass.name && c.schoolId === w.school.id));
  const gradeOf = (id: string) => cards.find((c) => c.studentId === id)?.grades[0];
  assert.deepEqual([gradeOf(s0)?.predicate, gradeOf(s1)?.predicate, gradeOf(s2)?.predicate], ["A", "B", "D"]);
  assert.equal(gradeOf(s1)?.description, "Baik sekali");
  assert.equal(gradeOf(s0)?.kkmSnapshot, 75);
  assert.equal(gradeOf(s0)?.subjectNameSnapshot, "Matematika");
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: w.klass.id, action: "report_card.grades_upsert" } }));

  const again = await putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: s0, score: 92 }, { studentId: s1, score: 84, description: "Baik sekali" }]));
  assert.deepEqual(again.body?.data, { updated: 0, unchanged: 2, deleted: 0, createdReportCards: 0 });

  const removed = await putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: s2, score: null }]));
  assert.deepEqual(removed.body?.data, { updated: 0, unchanged: 0, deleted: 1, createdReportCards: 0 });
  assert.equal(await prisma.reportCardGrade.count({ where: { reportCard: { studentId: s2 } } }), 0);
  assert.equal(await prisma.reportCard.count({ where: { studentId: s2 } }), 1);
});

test("score null untuk siswa tanpa rapor tidak membuat rapor", async () => {
  const w = await createRcWorld(1);
  const res = await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: w.students[0]!.student.id, score: null }]));
  assert.deepEqual(res.body?.data, { updated: 0, unchanged: 0, deleted: 0, createdReportCards: 0 });
  assert.equal(await prisma.reportCard.count({ where: { studentId: w.students[0]!.student.id } }), 0);
});

test("validasi zod -> 400 VALIDATION_FAILED", async () => {
  const w = await createRcWorld(1);
  const id = w.students[0]!.student.id;
  const tooMany = Array.from({ length: 101 }, (_, i) => ({ studentId: `${id}-${i}`, score: 80 }));
  for (const entries of [[{ studentId: id, score: "90" }], [{ studentId: id, score: 100.5 }], [{ studentId: id, score: 101 }], [{ studentId: id, score: -1 }], [{ studentId: id }], [], tooMany, [{ studentId: id, score: 80, description: "x".repeat(501) }], [{ studentId: id, score: 80, extra: 1 }]]) {
    const res = await putBulk(w.adminToken, { ...bulkBody(w, 0, []), entries });
    assert.equal(res.status, 400, JSON.stringify(entries).slice(0, 80));
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
  assert.equal(await prisma.reportCard.count({ where: { classId: w.klass.id } }), 0);
});

test("satu baris salah -> 400 GRADE_ROWS_INVALID dengan rowErrors dan tidak ada yang ditulis", async () => {
  const w = await createRcWorld(2);
  const [s0, s1] = w.students.map((s) => s.student.id) as [string, string];
  const inactive = await addStudent(w, { status: "INACTIVE" });
  const otherClass = await createClass(w.school.id, w.academicYearId, { name: uniq("IX") });
  const elsewhere = await createStudent(w.school.id, { classId: otherClass.id });
  const res = await putBulk(w.adminToken, bulkBody(w, 0, [
    { studentId: s0, score: 90 },
    { studentId: s1, score: 80 },
    { studentId: s0, score: 70 },
    { studentId: inactive.student.id, score: 70 },
    { studentId: elsewhere.student.id, score: 70 },
    { studentId: "tidak-ada", score: 70 },
  ]));
  assert.equal(res.status, 400);
  assert.equal(res.body?.error?.code, "GRADE_ROWS_INVALID");
  const rowErrors = (res.body?.error?.details as { rowErrors: Array<{ index: number; code: string }> }).rowErrors;
  assert.deepEqual(rowErrors.map((e) => [e.index, e.code]), [[2, "DUPLICATE_STUDENT"]]);
  const eligibility = await putBulk(w.adminToken, bulkBody(w, 0, [
    { studentId: s0, score: 90 },
    { studentId: inactive.student.id, score: 70 },
    { studentId: elsewhere.student.id, score: 70 },
    { studentId: "tidak-ada", score: 70 },
  ]));
  assert.equal(eligibility.status, 400);
  const errors = (eligibility.body?.error?.details as { rowErrors: Array<{ index: number; code: string }> }).rowErrors;
  assert.deepEqual(errors.map((e) => [e.index, e.code]), [[1, "STUDENT_NOT_ELIGIBLE"], [2, "STUDENT_NOT_ELIGIBLE"], [3, "STUDENT_NOT_ELIGIBLE"]]);
  assert.equal(await prisma.reportCard.count({ where: { termId: w.term.id } }), 0);
});

test("siswa aktif dengan rapor semester ini di kelas lain -> REPORT_CARD_OTHER_CLASS; grid menandai OTHER_CLASS", async () => {
  const w = await createRcWorld(1);
  const moved = w.students[0]!.student.id;
  const oldClass = await createClass(w.school.id, w.academicYearId, { name: uniq("VIIX") });
  await prisma.reportCard.create({ data: { schoolId: w.school.id, studentId: moved, termId: w.term.id, classId: oldClass.id, classNameSnapshot: oldClass.name } });
  const res = await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: moved, score: 80 }]));
  assert.equal(res.status, 400);
  const [error] = (res.body?.error?.details as { rowErrors: Array<{ code: string; message: string }> }).rowErrors;
  assert.equal(error?.code, "REPORT_CARD_OTHER_CLASS");
  assert.match(error?.message ?? "", new RegExp(oldClass.name));
  const sheet = await getSheet(w.adminToken, termQuery(w, `&subjectId=${w.subjects[0].id}`));
  assert.equal(sheet.status, 200);
  assert.equal(sheet.body?.data.rows[0]?.blockedReason, "OTHER_CLASS");
});

test("mapel tidak dipetakan -> 422; kelas beda tahun ajaran -> 422; semester/kelas/mapel tak dikenal -> 404", async () => {
  const w = await createRcWorld(1);
  const id = w.students[0]!.student.id;
  const unmapped = await createSubject(w.school.id, "Seni", 75);
  const notMapped = await putBulk(w.adminToken, { ...bulkBody(w, 0, [{ studentId: id, score: 80 }]), subjectId: unmapped.id });
  assert.equal(notMapped.status, 422);
  assert.equal(notMapped.body?.error?.code, "SUBJECT_NOT_IN_CLASS");
  const oldYear = await createAcademicYearWithTerm(w.school.id, {
    name: "2019/2020", yearStart: "2019-07-15", yearEnd: "2020-06-27", termStart: "2019-07-15", termEnd: "2019-12-21", active: false,
  });
  const mismatch = await putBulk(w.adminToken, { ...bulkBody(w, 0, [{ studentId: id, score: 80 }]), termId: oldYear.term.id });
  assert.equal(mismatch.status, 422);
  assert.equal(mismatch.body?.error?.code, "CLASS_TERM_MISMATCH");
  for (const patch of [{ termId: "tidak-ada" }, { classId: "tidak-ada" }, { subjectId: "tidak-ada" }]) {
    assert.equal((await putBulk(w.adminToken, { ...bulkBody(w, 0, [{ studentId: id, score: 80 }]), ...patch })).status, 404, JSON.stringify(patch));
  }
  assert.equal(await prisma.reportCard.count({ where: { studentId: id } }), 0);
});

test("rapor terbit memblokir input massal: 409 REPORT_CARD_PUBLISHED {studentIds}, tidak ada yang ditulis", async () => {
  const w = await createRcWorld(2);
  const [s0, s1] = w.students.map((s) => s.student.id) as [string, string];
  await gradeAll(w, [s0], 90);
  const pub = await publish(w.adminToken, { termId: w.term.id, classId: w.klass.id, studentIds: [s0] });
  assert.equal(pub.status, 200, JSON.stringify(pub.body?.error));
  const res = await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: s1, score: 60 }, { studentId: s0, score: 50 }]));
  assert.equal(res.status, 409);
  assert.equal(res.body?.error?.code, "REPORT_CARD_PUBLISHED");
  assert.deepEqual((res.body?.error?.details as { studentIds: string[] }).studentIds, [s0]);
  assert.equal(await prisma.reportCard.count({ where: { studentId: s1 } }), 0);
  const kept = await prisma.reportCardGrade.findFirst({ where: { reportCard: { studentId: s0 }, subjectId: w.subjects[0].id } });
  assert.equal(kept?.score, 90);
  const single = await putCardGrades(w.adminToken, await cardIdOf(w, s0), [{ subjectId: w.subjects[0].id, score: 10 }]);
  assert.equal(single.status, 409);
  assert.equal(single.body?.error?.code, "REPORT_CARD_PUBLISHED");
});

test("grid nilai: siswa aktif + pemegang rapor (walau sudah nonaktif), predikat DRAFT dari KKM terkini, PUBLISHED beku", async () => {
  const w = await createRcWorld(3);
  const [s0, s1, s2] = w.students.map((s) => s.student.id) as [string, string, string];
  await putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: s0, score: 80 }, { studentId: s1, score: 90 }]));
  await gradeAll(w, [s2], 80);
  assert.equal((await publish(w.adminToken, { termId: w.term.id, classId: w.klass.id, studentIds: [s2] })).status, 200);
  await prisma.student.update({ where: { id: s1 }, data: { status: "INACTIVE" } });
  await prisma.subject.update({ where: { id: w.subjects[1].id }, data: { kkm: 60 } });
  const extra = await addStudent(w);
  const sheet = await getSheet(w.adminToken, termQuery(w, `&subjectId=${w.subjects[1].id}`));
  assert.equal(sheet.status, 200, JSON.stringify(sheet.body?.error));
  assert.equal(sheet.body?.data.subject.kkm, 60);
  const byId = new Map(sheet.body?.data.rows.map((r) => [r.studentId as string, r]));
  assert.equal(byId.size, 4);
  assert.deepEqual([byId.get(s0)?.score, byId.get(s0)?.predicate, byId.get(s0)?.blockedReason], [80, "B", null]);
  assert.deepEqual([byId.get(s1)?.studentStatus, byId.get(s1)?.predicate], ["INACTIVE", "A"]);
  // Terbit dengan KKM 75: 80 -> C (dibekukan); KKM terkini 60 akan memberi B.
  assert.deepEqual([byId.get(s2)?.predicate, byId.get(s2)?.blockedReason, byId.get(s2)?.reportCardStatus], ["C", "PUBLISHED", "PUBLISHED"]);
  assert.deepEqual([byId.get(extra.student.id)?.reportCardId, byId.get(extra.student.id)?.score], [null, null]);
  const unmapped = await createSubject(w.school.id, "Seni", 75);
  assert.equal((await getSheet(w.adminToken, termQuery(w, `&subjectId=${unmapped.id}`))).body?.error?.code, "SUBJECT_NOT_IN_CLASS");
  assert.equal((await getSheet(w.adminToken, termQuery(w))).status, 400);
});

test("nilai satu rapor: mapel terpetakan atau yang sudah dinilai; ganda/di luar kelas -> rowErrors", async () => {
  const w = await createRcWorld(1);
  const s0 = w.students[0]!.student.id;
  const [bin, mtk, ipa] = w.subjects;
  await putBulk(w.adminToken, bulkBody(w, 2, [{ studentId: s0, score: 88 }]));
  const cardId = await cardIdOf(w, s0);
  await prisma.classSubject.delete({ where: { classId_subjectId: { classId: w.klass.id, subjectId: ipa.id } } });
  const foreign = await createSubject(w.school.id, "Seni", 75);
  const bad = await putCardGrades(w.adminToken, cardId, [{ subjectId: bin.id, score: 80 }, { subjectId: foreign.id, score: 80 }, { subjectId: bin.id, score: 70 }]);
  assert.equal(bad.status, 400);
  const errors = (bad.body?.error?.details as { rowErrors: Array<{ index: number; code: string }> }).rowErrors;
  assert.deepEqual(errors.map((e) => [e.index, e.code]), [[1, "SUBJECT_NOT_IN_CLASS"], [2, "DUPLICATE_SUBJECT"]]);
  const ok = await putCardGrades(w.adminToken, cardId, [{ subjectId: mtk.id, score: 75, description: "Cukup" }, { subjectId: bin.id, score: 90 }, { subjectId: ipa.id, score: 95 }]);
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
  const detail = ok.body!.data;
  assert.deepEqual(detail.grades.map((g) => [g.subjectName, g.score, g.predicate, g.isMapped]), [
    ["Bahasa Indonesia", 90, "A", true], ["Matematika", 75, "C", true], ["IPA", 95, "A", false],
  ]);
  assert.deepEqual(detail.missingSubjectIds, []);
  assert.equal(detail.average, 86.67);
  assert.equal(detail.attendanceSummary.isSnapshot, false);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: cardId, action: "report_card.grades_upsert" } }));
  const cleared = await putCardGrades(w.adminToken, cardId, [{ subjectId: bin.id, score: null }]);
  assert.deepEqual(cleared.body?.data.missingSubjectIds, [bin.id]);
});

test("deskripsi tidak dikirim dipertahankan (massal & satu rapor); null menghapus; skor sama tanpa deskripsi = unchanged", async () => {
  const w = await createRcWorld(1);
  const s0 = w.students[0]!.student.id;
  const mtk = w.subjects[1];
  const descriptionNow = async () => (await prisma.reportCardGrade.findFirstOrThrow({ where: { reportCard: { studentId: s0 }, subjectId: mtk.id } })).description;
  await putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: s0, score: 80, description: "Deskripsi lama" }]));
  const bulkScoreOnly = await putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: s0, score: 85 }]));
  assert.deepEqual(bulkScoreOnly.body?.data, { updated: 1, unchanged: 0, deleted: 0, createdReportCards: 0 });
  assert.equal(await descriptionNow(), "Deskripsi lama");
  const bulkSame = await putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: s0, score: 85 }]));
  assert.deepEqual(bulkSame.body?.data, { updated: 0, unchanged: 1, deleted: 0, createdReportCards: 0 });
  const cardId = await cardIdOf(w, s0);
  const cardScoreOnly = await putCardGrades(w.adminToken, cardId, [{ subjectId: mtk.id, score: 90 }]);
  assert.equal(cardScoreOnly.status, 200, JSON.stringify(cardScoreOnly.body?.error));
  assert.equal(cardScoreOnly.body?.data.grades.find((g) => g.subjectId === mtk.id)?.description, "Deskripsi lama");
  const cleared = await putCardGrades(w.adminToken, cardId, [{ subjectId: mtk.id, score: 90, description: null }]);
  assert.equal(cleared.body?.data.grades.find((g) => g.subjectId === mtk.id)?.description, null);
  assert.equal(await descriptionNow(), null);
});
