import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { School, SchoolClass } from "@prisma/client";
import { PUT } from "@/app/api/v1/school/attendance/students/[studentId]/days/[date]/route";
import { addDays, toDbDate } from "@/lib/time/zone";
import { holdTx, raceWhileHeld, webToken, withSchool } from "../../academics/helpers";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createClass, createSchoolAdmin, createStudent, createSuperAdmin, type TestStudent } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { autoAlphaRow, checkInRow, createAttendanceSchool, pastSchoolDate, useInlineDefer, wibToday } from "./fixtures";

interface Corrected {
  attendance: {
    id: string;
    studentId: string;
    classId: string | null;
    date: string;
    status: string;
    source: string;
    lateMinutes: number | null;
    checkInAt: string | null;
    note: string | null;
    hasAnomaly: boolean;
  };
  unchanged: boolean;
}

const today = wibToday();
let schoolA: School;
let schoolB: School;
let classA: SchoolClass;
let adminA: string;
let superToken: string;
let restoreDefer: () => void = () => undefined;

before(async () => {
  restoreDefer = useInlineDefer();
  const setup = { createdAt: new Date(Date.now() - 150 * 86_400_000), termStart: addDays(today, -100), termEnd: addDays(today, 30) };
  schoolA = await createAttendanceSchool(setup);
  schoolB = await createAttendanceSchool(setup);
  const term = await prisma.term.findFirstOrThrow({ where: { schoolId: schoolA.id } });
  classA = await createClass(schoolA.id, term.academicYearId);
  adminA = await webToken((await createSchoolAdmin(schoolA.id)).id);
  superToken = await webToken((await createSuperAdmin()).id);
});
after(async () => {
  restoreDefer();
  await disconnect();
});

const studentA = (): Promise<TestStudent> => createStudent(schoolA.id, { classId: classA.id });

function put(studentId: string, date: string, body: unknown, token: string, schoolId?: string) {
  return callRoute<Envelope<Corrected>>(PUT, {
    method: "PUT",
    url: withSchool(`/api/v1/school/attendance/students/${studentId}/days/${date}`, schoolId),
    bearer: token,
    json: body,
    params: { studentId, date },
  });
}

const auditsFor = (entityId: string) => prisma.auditLog.findMany({ where: { entityId, action: "attendance.correct" } });
const notificationsFor = (userId: string) => prisma.notification.findMany({ where: { userId, type: "ATTENDANCE_CORRECTED" } });

test("tanpa baris -> dibuat sumber ADMIN dengan kelas saat ini, diaudit, siswa dinotifikasi", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([1, 2, 3, 4]);
  const res = await put(st.student.id, date, { status: "HADIR", reason: "Mengikuti lomba OSN" }, adminA);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const { attendance, unchanged } = res.body!.data;
  assert.equal(unchanged, false);
  assert.deepEqual(
    { status: attendance.status, source: attendance.source, classId: attendance.classId, note: attendance.note, date: attendance.date, lateMinutes: attendance.lateMinutes },
    { status: "HADIR", source: "ADMIN", classId: classA.id, note: "Mengikuti lomba OSN", date, lateMinutes: null },
  );
  const [audit] = await auditsFor(attendance.id);
  assert.equal(audit?.schoolId, schoolA.id);
  assert.equal(audit?.before, null);
  assert.equal((audit?.after as { status: string }).status, "HADIR");
  const [note] = await notificationsFor(st.user.id);
  assert.deepEqual(note?.data, { screen: "attendance", id: attendance.id });
  assert.equal(note?.pushStatus, "PENDING");
});

test("CHECKIN TERLAMBAT -> HADIR: lateMinutes dihapus, sumber ADMIN, bukti check-in tetap", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([2, 3, 4, 5]);
  const original = await checkInRow({
    schoolId: schoolA.id, studentId: st.student.id, userId: st.user.id, date, deviceId: uniq("dev"), status: "TERLAMBAT", lateMinutes: 16, anomalyFlags: ["LOW_ACCURACY"],
  });
  const res = await put(st.student.id, date, { status: "HADIR", lateMinutes: null, reason: "Gerbang terkunci" }, adminA);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const row = await prisma.attendance.findFirstOrThrow({ where: { id: original.id } });
  assert.deepEqual([row.status, row.lateMinutes, row.source, row.note], ["HADIR", null, "ADMIN", "Gerbang terkunci"]);
  assert.deepEqual(
    [row.selfieFileId, String(row.latitude), row.deviceId, row.checkInAt?.toISOString(), row.anomalyFlags],
    [original.selfieFileId, String(original.latitude), original.deviceId, original.checkInAt?.toISOString(), ["LOW_ACCURACY"]],
  );
  const [audit] = await auditsFor(original.id);
  assert.deepEqual(
    { ...(audit?.before as Record<string, unknown>) },
    { status: "TERLAMBAT", source: "CHECKIN", lateMinutes: 16, note: null, date, studentId: st.student.id },
  );
});

test("status sama -> unchanged=true tanpa audit dan tanpa notifikasi; TERLAMBAT menyimpan lateMinutes", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([3, 4, 5, 6]);
  const alpha = await autoAlphaRow({ schoolId: schoolA.id, studentId: st.student.id, date });
  const same = await put(st.student.id, date, { status: "ALPHA", reason: "Cek ulang data" }, adminA);
  assert.equal(same.status, 200);
  assert.equal(same.body?.data.unchanged, true);
  assert.equal(same.body?.data.attendance.source, "AUTO_ALPHA");
  assert.equal((await auditsFor(alpha.id)).length, 0);
  assert.equal((await notificationsFor(st.user.id)).length, 0);

  const late = await put(st.student.id, date, { status: "TERLAMBAT", lateMinutes: 25, reason: "Datang pukul 07.40" }, adminA);
  assert.equal(late.status, 200, JSON.stringify(late.body?.error));
  assert.deepEqual([late.body?.data.attendance.status, late.body?.data.attendance.lateMinutes], ["TERLAMBAT", 25]);
  assert.equal((await notificationsFor(st.user.id)).length, 1);
});

test("validasi bentuk -> 400 VALIDATION_FAILED", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([1, 2, 3, 4]);
  const bodies = [
    { status: "TERLAMBAT", reason: "Terlambat upacara" },
    { status: "TERLAMBAT", lateMinutes: 721, reason: "Terlambat upacara" },
    { status: "HADIR", lateMinutes: 5, reason: "Salah input admin" },
    { status: "HADIR", reason: "abc" },
    { status: "BOLOS", reason: "Status tidak dikenal" },
    { status: "HADIR", reason: "Field asing", source: "CHECKIN" },
  ];
  for (const body of bodies) {
    const res = await put(st.student.id, date, body, adminA);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
  const badDate = await put(st.student.id, "2026-02-30", { status: "HADIR", reason: "Tanggal salah" }, adminA);
  assert.equal(badDate.status, 400);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
});

test("aturan tanggal -> 422: masa depan, bukan hari sekolah, jendela 45 hari (super admin bebas)", async () => {
  const st = await studentA();
  const body = { status: "SAKIT", reason: "Surat dokter menyusul" };
  const future = await put(st.student.id, addDays(today, 1), body, adminA);
  assert.deepEqual([future.status, future.body?.error?.code], [422, "FUTURE_DATE"]);

  const holidayDate = await pastSchoolDate([6, 7, 8, 9]);
  await prisma.holiday.create({ data: { schoolId: schoolA.id, name: uniq("Libur"), startDate: toDbDate(holidayDate), endDate: toDbDate(holidayDate) } });
  const holiday = await put(st.student.id, holidayDate, body, adminA);
  assert.deepEqual([holiday.status, holiday.body?.error?.code], [422, "NOT_SCHOOL_DAY"]);
  const outsideTerm = await put(st.student.id, addDays(today, -110), body, superToken, schoolA.id);
  assert.deepEqual([outsideTerm.status, outsideTerm.body?.error?.code], [422, "NOT_SCHOOL_DAY"]);

  const old = await pastSchoolDate([46, 47, 48, 49]);
  const expired = await put(st.student.id, old, body, adminA);
  assert.deepEqual([expired.status, expired.body?.error?.code], [422, "CORRECTION_WINDOW_EXPIRED"]);
  const bySuper = await put(st.student.id, old, body, superToken, schoolA.id);
  assert.equal(bySuper.status, 200, JSON.stringify(bySuper.body?.error));
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 1);
});

test("gerbang peran: siswa -> 403", async () => {
  const st = await studentA();
  const token = (await createSessionToken(st.user.id)).token;
  const res = await put(st.student.id, await pastSchoolDate([1, 2, 3]), { status: "HADIR", reason: "Koreksi sendiri" }, token);
  assert.equal(res.status, 403);
});

test("IDOR dua sekolah: siswa sekolah lain 404, schoolId lain 403, super admin tanpa schoolId 400", async () => {
  const foreign = await createStudent(schoolB.id);
  const date = await pastSchoolDate([1, 2, 3, 4]);
  const body = { status: "ALPHA", reason: "Uji lintas sekolah" };
  assert.equal((await put(foreign.student.id, date, body, adminA)).status, 404);
  const mismatch = await put(foreign.student.id, date, body, adminA, schoolB.id);
  assert.deepEqual([mismatch.status, mismatch.body?.error?.code], [403, "SCOPE_MISMATCH"]);
  const noScope = await put(foreign.student.id, date, body, superToken);
  assert.deepEqual([noScope.status, noScope.body?.error?.code], [400, "SCHOOL_ID_REQUIRED"]);
  assert.equal((await put(foreign.student.id, date, body, superToken, schoolA.id)).status, 404);
  assert.equal((await put("tidak-ada", date, body, adminA)).status, 404);
  assert.equal(await prisma.attendance.count({ where: { studentId: foreign.student.id } }), 0);
  const ok = await put(foreign.student.id, date, body, superToken, schoolB.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
});

test("koreksi paralel siswa+tanggal yang sama diserialkan kunci attendance: satu baris, keduanya 200", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([4, 5, 6, 7]);
  const [a, b] = await Promise.all([
    put(st.student.id, date, { status: "IZIN", reason: "Surat izin orang tua" }, adminA),
    put(st.student.id, date, { status: "SAKIT", reason: "Surat dokter klinik" }, adminA),
  ]);
  assert.deepEqual([a.status, b.status], [200, 200], JSON.stringify([a.body?.error, b.body?.error]));
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id, date: toDbDate(date) } }), 1);
});

test("INSERT koreksi kalah balapan dengan INSERT auto-ALPHA (P2002) -> diulang sebagai update", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([5, 6, 7, 8]);
  const held = await holdTx((tx) =>
    tx.attendance.create({ data: { schoolId: schoolA.id, studentId: st.student.id, date: toDbDate(date), status: "ALPHA", source: "AUTO_ALPHA" } }),
  );
  const [res] = await raceWhileHeld(held, [() => put(st.student.id, date, { status: "HADIR", reason: "Hadir, lupa check-in" }, adminA)]);
  assert.equal(res?.status, 200, JSON.stringify(res?.body?.error));
  const rows = await prisma.attendance.findMany({ where: { studentId: st.student.id, date: toDbDate(date) } });
  assert.deepEqual(rows.map((r) => [r.status, r.source, r.note]), [["HADIR", "ADMIN", "Hadir, lupa check-in"]]);
  const [audit] = await auditsFor(rows[0]!.id);
  assert.equal((audit?.before as { source: string }).source, "AUTO_ALPHA");
});
