/**
 * Kesiapan, terbit (semua-atau-tidak, snapshot, rekap kehadiran, notifikasi), tarik terbit, dan tampilan
 * siswa (hanya rapor TERBIT miliknya).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { addDays } from "@/lib/time/zone";
import { createClass } from "../helpers/factories";
import { disconnect, prisma, uniq } from "../helpers/db";
import {
  addAttendance,
  bulkBody,
  cardIdOf,
  createRcWorld,
  getCard,
  getReadiness,
  gradeAll,
  ownDetail,
  ownList,
  publish,
  putBulk,
  putCardGrades,
  termQuery,
  todayWib,
  unpublish,
  type RcWorld,
} from "./helpers";

after(disconnect);

const publishBody = (w: RcWorld, studentIds?: string[]) => ({ termId: w.term.id, classId: w.klass.id, ...(studentIds ? { studentIds } : {}) });
const notificationsOf = (userId: string) => prisma.notification.findMany({ where: { userId, type: "REPORT_CARD_PUBLISHED" }, orderBy: { createdAt: "asc" } });

test("kesiapan: ready / incomplete / noReportCard / published; kelas tanpa mapel -> 422", async () => {
  const w = await createRcWorld(4);
  const [s0, s1, s2, s3] = w.students.map((s) => s.student.id) as [string, string, string, string];
  await gradeAll(w, [s0, s3], 85);
  await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: s1, score: 70 }]));
  assert.equal((await publish(w.adminToken, publishBody(w, [s3]))).status, 200);
  const res = await getReadiness(w.adminToken, termQuery(w));
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const data = res.body!.data;
  assert.equal(data.subjectCount, 3);
  assert.deepEqual(data.ready.map((r) => r.studentId), [s0]);
  assert.deepEqual(data.incomplete.map((r) => [r.studentId, r.missingSubjectIds]), [[s1, [w.subjects[1].id, w.subjects[2].id]]]);
  assert.deepEqual(data.noReportCard, [s2]);
  assert.deepEqual(data.published.map((r) => r.studentId), [s3]);

  const empty = await createClass(w.school.id, w.academicYearId, { name: uniq("X") });
  const noSubjects = await getReadiness(w.adminToken, `?termId=${w.term.id}&classId=${empty.id}`);
  assert.equal(noSubjects.body?.error?.code, "CLASS_HAS_NO_SUBJECTS");
  const pubEmpty = await publish(w.adminToken, { termId: w.term.id, classId: empty.id });
  assert.equal(pubEmpty.status, 422);
  assert.equal(pubEmpty.body?.error?.code, "CLASS_HAS_NO_SUBJECTS");
});

test("terbit semua-atau-tidak: belum lengkap / tanpa rapor -> 422 REPORT_CARD_INCOMPLETE, tidak ada yang berubah", async () => {
  const w = await createRcWorld(3);
  const [s0, s1, s2] = w.students.map((s) => s.student.id) as [string, string, string];
  await gradeAll(w, [s0], 90);
  await putBulk(w.adminToken, bulkBody(w, 0, [{ studentId: s1, score: 70 }]));
  const res = await publish(w.adminToken, publishBody(w));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "REPORT_CARD_INCOMPLETE");
  const incomplete = (res.body?.error?.details as { incomplete: Array<{ reportCardId: string | null; studentId: string }> }).incomplete;
  assert.deepEqual(incomplete.map((i) => [i.studentId, i.reportCardId === null]), [[s1, false], [s2, true]]);
  assert.equal(await prisma.reportCard.count({ where: { termId: w.term.id, status: "PUBLISHED" } }), 0);
  assert.equal((await notificationsOf(w.students[0]!.user.id)).length, 0);

  const partial = await publish(w.adminToken, publishBody(w, [s0, s0]));
  assert.equal(partial.status, 200, JSON.stringify(partial.body?.error));
  assert.deepEqual(partial.body?.data, { publishedIds: [await cardIdOf(w, s0)], notified: 1 });
  const again = await publish(w.adminToken, publishBody(w, [s0]));
  assert.deepEqual(again.body?.data, { publishedIds: [], notified: 0 });
  assert.equal((await publish(w.adminToken, publishBody(w, [s2]))).body?.error?.code, "REPORT_CARD_INCOMPLETE");
});

test("snapshot terbit: predikat dihitung ulang dari KKM & nama mapel terkini, rekap kehadiran dalam batas semester", async () => {
  const w = await createRcWorld(1);
  const s0 = w.students[0]!;
  const sid = s0.student.id;
  await gradeAll(w, [sid], 84);
  await prisma.subject.update({ where: { id: w.subjects[1].id }, data: { kkm: 85, name: "Matematika Lanjut" } });
  const today = todayWib();
  await addAttendance(w.school.id, sid, addDays(w.termStart, -1), "SAKIT");
  await addAttendance(w.school.id, sid, w.termStart, "SAKIT");
  await addAttendance(w.school.id, sid, addDays(today, -5), "IZIN");
  await addAttendance(w.school.id, sid, addDays(today, -4), "HADIR");
  await addAttendance(w.school.id, sid, addDays(today, -3), "ALPHA");
  await addAttendance(w.school.id, sid, addDays(today, -2), "ALPHA");
  await addAttendance(w.school.id, sid, addDays(today, 1), "IZIN");
  const draft = await getCard(w.adminToken, await cardIdOf(w, sid));
  assert.deepEqual(draft.body?.data.attendanceSummary, { sick: 1, permit: 1, absent: 2, isSnapshot: false });

  const res = await publish(w.adminToken, publishBody(w));
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const card = await prisma.reportCard.findFirstOrThrow({ where: { studentId: sid }, include: { grades: true } });
  assert.equal(card.status, "PUBLISHED");
  assert.deepEqual([card.sickDays, card.permitDays, card.absentDays], [1, 1, 2]);
  assert.ok(card.publishedAt && card.publishedById);
  const math = card.grades.find((g) => g.subjectId === w.subjects[1].id);
  assert.deepEqual([math?.kkmSnapshot, math?.predicate, math?.subjectNameSnapshot], [85, "D", "Matematika Lanjut"]);
  assert.ok(await prisma.auditLog.findFirst({ where: { entityId: w.klass.id, action: "report_card.publish" } }));

  await prisma.subject.update({ where: { id: w.subjects[1].id }, data: { kkm: 50, name: "Ganti Lagi" } });
  await addAttendance(w.school.id, sid, addDays(today, -1), "SAKIT");
  const frozen = await getCard(w.adminToken, card.id);
  const frozenMath = frozen.body?.data.grades.find((g) => g.subjectId === w.subjects[1].id);
  assert.deepEqual([frozenMath?.kkm, frozenMath?.predicate, frozenMath?.subjectName], [85, "D", "Matematika Lanjut"]);
  assert.deepEqual(frozen.body?.data.attendanceSummary, { sick: 1, permit: 1, absent: 2, isSnapshot: true });
  const own = await ownDetail(s0.token, card.id);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body?.data.attendance, { sick: 1, permit: 1, absent: 2 });
  assert.deepEqual(own.body?.data.grades.map((g) => [g.subjectName, g.kkm, g.predicate]), [
    ["Bahasa Indonesia", 70, "B"], ["Matematika Lanjut", 85, "D"], ["IPA", 80, "C"],
  ]);
  assert.equal(own.body?.data.average, 84);
});

test("notifikasi satu per siswa dengan tautan rapor; siswa hanya melihat rapor TERBIT miliknya", async () => {
  const w = await createRcWorld(2);
  const [a, b] = w.students as [typeof w.students[0], typeof w.students[0]];
  await gradeAll(w, [a.student.id, b.student.id], 88);
  const aCard = await cardIdOf(w, a.student.id);
  assert.deepEqual((await ownList(a.token)).body?.data, []);
  assert.equal((await ownDetail(a.token, aCard)).status, 404);

  const res = await publish(w.adminToken, publishBody(w));
  assert.equal(res.body?.data.notified, 2);
  for (const student of [a, b]) {
    const notes = await notificationsOf(student.user.id);
    assert.equal(notes.length, 1);
    assert.equal(notes[0]?.title, "Rapor terbit");
    // Siswa -> antre push (bukan SKIPPED); status akhir bergantung dispatcher yang terdaftar.
    assert.notEqual(notes[0]?.pushStatus, "SKIPPED");
    assert.deepEqual(notes[0]?.data, { screen: "report-card", id: await cardIdOf(w, student.student.id) });
  }
  const list = await ownList(a.token);
  assert.equal(list.status, 200);
  assert.deepEqual(list.body?.data.map((c) => [c.id, c.className, c.average]), [[aCard, w.klass.name, 88]]);
  assert.match(list.body?.data[0]?.termLabel ?? "", /^Semester Ganjil /);
  assert.equal((await ownDetail(b.token, aCard)).status, 404);

  await prisma.student.update({ where: { id: a.student.id }, data: { status: "GRADUATED" } });
  assert.equal((await ownList(a.token)).status, 200);
  await prisma.student.update({ where: { id: b.student.id }, data: { status: "INACTIVE" } });
  const inactive = await ownList(b.token);
  assert.ok([401, 403].includes(inactive.status), `siswa nonaktif ditolak (${inactive.status})`);
});

test("tarik terbit: alasan wajib, siswa 404, bisa diedit lagi, terbit ulang -> 'Rapor diperbarui'", async () => {
  const w = await createRcWorld(1);
  const s0 = w.students[0]!;
  await gradeAll(w, [s0.student.id], 80);
  await publish(w.adminToken, publishBody(w));
  const cardId = await cardIdOf(w, s0.student.id);
  for (const body of [{ reportCardIds: [cardId], reason: "abc" }, { reportCardIds: [], reason: "Salah input nilai" }, { reportCardIds: [cardId] }]) {
    assert.equal((await unpublish(w.adminToken, body)).status, 400, JSON.stringify(body));
  }
  const res = await unpublish(w.adminToken, { reportCardIds: [cardId, cardId], reason: "Salah input nilai IPA" });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual(res.body?.data, { unpublishedIds: [cardId] });
  const card = await prisma.reportCard.findUniqueOrThrow({ where: { id: cardId } });
  assert.deepEqual([card.status, card.publishedAt, card.publishedById], ["DRAFT", null, null]);
  assert.equal((await ownDetail(s0.token, cardId)).status, 404);
  assert.deepEqual((await ownList(s0.token)).body?.data, []);
  const audit = await prisma.auditLog.findFirst({ where: { entityId: w.klass.id, action: "report_card.unpublish" } });
  assert.match(JSON.stringify(audit?.after), /Salah input nilai IPA/);
  assert.equal((await notificationsOf(s0.user.id)).length, 1);

  const twice = await unpublish(w.adminToken, { reportCardIds: [cardId], reason: "Salah input nilai IPA" });
  assert.equal(twice.status, 409);
  assert.equal(twice.body?.error?.code, "REPORT_CARD_NOT_PUBLISHED");
  assert.equal((await putCardGrades(w.adminToken, cardId, [{ subjectId: w.subjects[2].id, score: 99 }])).status, 200);
  assert.equal((await publish(w.adminToken, publishBody(w))).status, 200);
  const notes = await notificationsOf(s0.user.id);
  assert.deepEqual(notes.map((n) => n.title), ["Rapor terbit", "Rapor diperbarui"]);
  assert.equal((await ownDetail(s0.token, cardId)).status, 200);
});
