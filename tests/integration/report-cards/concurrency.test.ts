/**
 * Konkurensi rapor: semua penulis satu kelas & semester menyerialkan pada kunci `grades:<termId>:<classId>`.
 * - input nilai vs terbit: tidak pernah ada nilai berubah pada rapor TERBIT (snapshot = nilai tersimpan);
 * - input massal paralel: rapor lazy tidak ganda;
 * - terbit paralel: terbit & notifikasi tepat sekali per siswa.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { gradesLockKey } from "@/lib/report-cards/constants";
import { computePredicate } from "@/lib/report-cards/rules";
import { disconnect, prisma } from "../helpers/db";
import { holdLock, raceWhileHeld } from "../academics/helpers";
import { bulkBody, cardIdOf, createRcWorld, gradeAll, publish, putBulk, type RcWorld } from "./helpers";

after(disconnect);

const publishAll = (w: RcWorld) => publish(w.adminToken, { termId: w.term.id, classId: w.klass.id });

/** Invarian: rapor TERBIT -> nilainya persis yang dibekukan (predikat konsisten dengan KKM snapshot). */
async function assertPublishedConsistent(w: RcWorld, studentId: string, bulkStatus: number, oldScore: number, newScore: number): Promise<void> {
  const card = await prisma.reportCard.findFirstOrThrow({ where: { studentId, termId: w.term.id }, include: { grades: true } });
  const math = card.grades.find((g) => g.subjectId === w.subjects[1].id);
  assert.equal(card.status, "PUBLISHED");
  assert.ok(bulkStatus === 200 || bulkStatus === 409, `status input ${bulkStatus}`);
  assert.equal(math?.score, bulkStatus === 200 ? newScore : oldScore);
  assert.equal(math?.predicate, computePredicate(math?.score ?? -1, math?.kkmSnapshot ?? -1));
}

test("input nilai menunggu kunci terbit (dan sebaliknya): tidak ada nilai berubah pada rapor TERBIT", async () => {
  const w = await createRcWorld(1);
  const sid = w.students[0]!.student.id;
  await gradeAll(w, [sid], 80);
  const held = await holdLock(gradesLockKey(w.term.id, w.klass.id));
  const [pubStatus, bulkStatus] = await raceWhileHeld(held, [
    () => publishAll(w).then((r) => r.status),
    () => putBulk(w.adminToken, bulkBody(w, 1, [{ studentId: sid, score: 55 }])).then((r) => r.status),
  ]);
  assert.equal(pubStatus, 200);
  await assertPublishedConsistent(w, sid, bulkStatus ?? 0, 80, 55);
});

test("input nilai & terbit paralel berulang: invarian snapshot selalu terjaga", async () => {
  for (let round = 0; round < 4; round += 1) {
    const w = await createRcWorld(2);
    const ids = w.students.map((s) => s.student.id);
    await gradeAll(w, ids, 80);
    const [pub, bulk] = await Promise.all([publishAll(w), putBulk(w.adminToken, bulkBody(w, 1, ids.map((studentId) => ({ studentId, score: 99 }))))]);
    assert.equal(pub.status, 200, JSON.stringify(pub.body?.error));
    for (const id of ids) await assertPublishedConsistent(w, id, bulk.status, 80, 99);
  }
});

test("input massal paralel (mapel berbeda) untuk siswa tanpa rapor: satu rapor per siswa, semua nilai tersimpan", async () => {
  const w = await createRcWorld(5);
  const ids = w.students.map((s) => s.student.id);
  const results = await Promise.all(([0, 1, 2] as const).map((i) => putBulk(w.adminToken, bulkBody(w, i, ids.map((studentId) => ({ studentId, score: 70 + i }))))));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200], JSON.stringify(results.map((r) => r.body?.error)));
  assert.equal(results.reduce((sum, r) => sum + (r.body?.data.createdReportCards ?? 0), 0), ids.length);
  assert.equal(await prisma.reportCard.count({ where: { termId: w.term.id, studentId: { in: ids } } }), ids.length);
  assert.equal(await prisma.reportCardGrade.count({ where: { reportCard: { studentId: { in: ids } } } }), ids.length * 3);
});

test("terbit paralel kelas yang sama: tepat satu yang menerbitkan, satu notifikasi per siswa", async () => {
  const w = await createRcWorld(3);
  const ids = w.students.map((s) => s.student.id);
  await gradeAll(w, ids, 90);
  const results = await Promise.all([publishAll(w), publishAll(w), publishAll(w)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);
  const published = results.map((r) => r.body?.data.publishedIds.length ?? 0).sort();
  assert.deepEqual(published, [0, 0, 3]);
  for (const student of w.students) {
    assert.equal(await prisma.notification.count({ where: { userId: student.user.id, type: "REPORT_CARD_PUBLISHED" } }), 1);
  }
  assert.equal(await prisma.reportCard.count({ where: { id: { in: await Promise.all(ids.map((id) => cardIdOf(w, id))) }, status: "PUBLISHED" } }), 3);
});
