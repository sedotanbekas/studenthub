/**
 * IDOR dua sekolah & gerbang peran untuk rapor: id sekolah lain -> 404 (data tidak berubah), admin sekolah
 * dengan schoolId lain -> 403 SCOPE_MISMATCH, super admin tanpa schoolId -> 400 SCHOOL_ID_REQUIRED, siswa
 * pada route admin / admin pada route siswa -> 403, siswa hanya membaca rapor terbit miliknya.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { disconnect, prisma } from "../helpers/db";
import type { RouteResult, Envelope } from "../helpers/request";
import {
  bulkBody,
  cardIdOf,
  createCard,
  createRcWorld,
  deleteCard,
  getCard,
  getReadiness,
  getSheet,
  gradeAll,
  listCards,
  ownDetail,
  ownList,
  publish,
  putBulk,
  putCardGrades,
  superAdminToken,
  termQuery,
  unpublish,
  withSchool,
  type RcWorld,
} from "./helpers";

let a: RcWorld;
let b: RcWorld;
let superToken = "";
let bCard = "";
let aCard = "";

before(async () => {
  [a, b] = [await createRcWorld(1), await createRcWorld(1)];
  superToken = await superAdminToken();
  await gradeAll(a, [a.students[0]!.student.id], 80);
  await gradeAll(b, [b.students[0]!.student.id], 80);
  for (const w of [a, b]) assert.equal((await publish(w.adminToken, { termId: w.term.id, classId: w.klass.id })).status, 200);
  [aCard, bCard] = [await cardIdOf(a, a.students[0]!.student.id), await cardIdOf(b, b.students[0]!.student.id)];
});
after(disconnect);

type Call = (token: string, schoolId?: string) => Promise<RouteResult<Envelope<unknown>>>;

/** Semua route admin rapor, diarahkan ke data sekolah B. */
function callsAgainstB(): Record<string, Call> {
  const bStudent = b.students[0]!.student.id;
  return {
    sheet: (t, s) => getSheet(t, withSchool(termQuery(b, `&subjectId=${b.subjects[0].id}`), s)),
    readiness: (t, s) => getReadiness(t, withSchool(termQuery(b), s)),
    bulk: (t, s) => putBulk(t, bulkBody(b, 0, [{ studentId: bStudent, score: 10 }]), s),
    create: (t, s) => createCard(t, { studentId: bStudent, termId: b.term.id }, s),
    detail: (t, s) => getCard(t, bCard, s),
    cardGrades: (t, s) => putCardGrades(t, bCard, [{ subjectId: b.subjects[0].id, score: 10 }], s),
    delete: (t, s) => deleteCard(t, bCard, s),
    publish: (t, s) => publish(t, { termId: b.term.id, classId: b.klass.id }, s),
    unpublish: (t, s) => unpublish(t, { reportCardIds: [bCard], reason: "Uji IDOR lintas sekolah" }, s),
  };
}

async function bUnchanged(): Promise<void> {
  const card = await prisma.reportCard.findUniqueOrThrow({ where: { id: bCard }, include: { grades: true } });
  assert.equal(card.status, "PUBLISHED");
  assert.ok(card.grades.every((g) => g.score === 80));
  assert.equal(await prisma.reportCard.count({ where: { schoolId: b.school.id } }), 1);
}

test("admin sekolah A pada id/rujukan sekolah B -> 404 (tanpa perubahan)", async () => {
  for (const [name, call] of Object.entries(callsAgainstB())) {
    const res = await call(a.adminToken);
    assert.equal(res.status, 404, `${name}: ${res.status} ${JSON.stringify(res.body?.error)}`);
  }
  await bUnchanged();
});

test("siswa sekolah B dalam payload kelas A -> 400 STUDENT_NOT_ELIGIBLE; rapor B tidak muncul di daftar A", async () => {
  const res = await putBulk(a.adminToken, bulkBody(a, 0, [{ studentId: b.students[0]!.student.id, score: 50 }]));
  assert.equal(res.status, 400);
  assert.equal((res.body?.error?.details as { rowErrors: Array<{ code: string }> }).rowErrors[0]?.code, "STUDENT_NOT_ELIGIBLE");
  const list = await listCards(a.adminToken, `?termId=${b.term.id}`);
  assert.deepEqual([list.status, list.body?.data], [200, []]);
  const publishForeignStudent = await publish(a.adminToken, { termId: a.term.id, classId: a.klass.id, studentIds: [b.students[0]!.student.id] });
  assert.equal(publishForeignStudent.body?.error?.code, "REPORT_CARD_INCOMPLETE");
  await bUnchanged();
});

test("admin sekolah A dengan ?schoolId=B -> 403 SCOPE_MISMATCH di semua route admin", async () => {
  for (const [name, call] of Object.entries(callsAgainstB())) {
    const res = await call(a.adminToken, b.school.id);
    assert.deepEqual([res.status, res.body?.error?.code], [403, "SCOPE_MISMATCH"], name);
  }
  const list = await listCards(a.adminToken, `?schoolId=${b.school.id}`);
  assert.equal(list.body?.error?.code, "SCOPE_MISMATCH");
  await bUnchanged();
});

test("super admin: tanpa schoolId -> 400; schoolId B -> berhasil; schoolId A untuk id B -> 404", async () => {
  for (const [name, call] of Object.entries(callsAgainstB())) {
    const res = await call(superToken);
    assert.deepEqual([res.status, res.body?.error?.code], [400, "SCHOOL_ID_REQUIRED"], name);
  }
  assert.equal((await getCard(superToken, bCard, b.school.id)).status, 200);
  assert.equal((await getCard(superToken, bCard, a.school.id)).status, 404);
  assert.equal((await listCards(superToken, `?schoolId=${b.school.id}`)).body?.data.length, 1);
  assert.equal((await listCards(superToken, "?schoolId=sekolah-tidak-ada")).body?.error?.code, "SCHOOL_NOT_FOUND");
  await bUnchanged();
});

test("gerbang peran: siswa pada route admin -> 403, admin pada route siswa -> 403", async () => {
  const studentToken = a.students[0]!.token;
  for (const [name, call] of Object.entries(callsAgainstB())) {
    const res = await call(studentToken);
    assert.deepEqual([res.status, res.body?.error?.code], [403, "FORBIDDEN"], name);
  }
  assert.equal((await listCards(studentToken)).status, 403);
  assert.equal((await ownList(a.adminToken)).status, 403);
  assert.equal((await ownDetail(superToken, aCard)).status, 403);
  assert.equal((await ownList("token-palsu")).status, 401);
});

test("siswa hanya membaca rapor terbit miliknya: rapor siswa sekolah lain -> 404", async () => {
  const aStudent = a.students[0]!;
  assert.equal((await ownDetail(aStudent.token, aCard)).status, 200);
  assert.equal((await ownDetail(aStudent.token, bCard)).status, 404);
  assert.equal((await ownDetail(b.students[0]!.token, aCard)).status, 404);
  assert.deepEqual((await ownList(aStudent.token)).body?.data.map((c) => c.id), [aCard]);
});
