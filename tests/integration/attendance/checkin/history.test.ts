/**
 * Riwayat bulanan & ringkasan semester siswa: angka tepat, pemotongan di hari yang sudah ditutup,
 * batas bulan, dan isolasi (hanya catatan milik sendiri; termId sekolah lain -> 404).
 * Service dipanggil dengan jam suntikan; route diuji dengan mock Date (hanya API Date).
 */
import { after, before, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import type { AttendanceSource, AttendanceStatus } from "@prisma/client";
import { GET as historyRoute } from "@/app/api/v1/student/attendance/route";
import { GET as summaryRoute } from "@/app/api/v1/student/attendance/summary/route";
import { getAttendanceMonth, getAttendanceSummary } from "@/lib/attendance/student-queries";
import { toDbDate, type LocalDate } from "@/lib/time/zone";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { createAcademicYearWithTerm, createSchoolAdmin, type TestStudent } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { actionContext, addStudent, createWorld, localInstant, studentPrincipal, type World } from "./fixtures";

/** "Hari ini" = 2091-03-25 09:00 WIB (sebelum akhir hari 15:00 -> closedThrough 2091-03-24). */
const NOW = localInstant("2091-03-25", 540, "WIB");
const AFTER_DAY_END = localInstant("2091-03-25", 900, "WIB");
let world: World;
let other: World;
let pastTermId = "";
let student: TestStudent;
let neighbour: TestStudent;

async function seedRow(st: TestStudent, date: LocalDate, status: AttendanceStatus, source: AttendanceSource, extra: { lateMinutes?: number; leaveRequestId?: string } = {}) {
  await prisma.attendance.create({
    data: { schoolId: st.student.schoolId, studentId: st.student.id, classId: world.classId, date: toDbDate(date), status, source, ...extra },
  });
}

async function seedLeave(st: TestStudent, date: LocalDate, type: "IZIN" | "SAKIT"): Promise<string> {
  const leave = await prisma.leaveRequest.create({
    data: { schoolId: st.student.schoolId, studentId: st.student.id, type, startDate: toDbDate(date), endDate: toDbDate(date), reason: "Keperluan keluarga mendesak", status: "APPROVED" },
  });
  return leave.id;
}

before(async () => {
  world = await createWorld({ termStart: "2091-03-10", termEnd: "2091-06-30" });
  other = await createWorld({ termStart: "2091-03-10", termEnd: "2091-06-30" });
  const past = await createAcademicYearWithTerm(world.school.id, {
    name: "2090/2091", yearStart: "2090-07-15", yearEnd: "2091-03-01", termStart: "2090-07-15", termEnd: "2090-12-20", active: false,
  });
  pastTermId = past.term.id;
  await prisma.holiday.create({ data: { schoolId: world.school.id, name: "Libur Riwayat", startDate: toDbDate("2091-03-20"), endDate: toDbDate("2091-03-21") } });
  student = await addStudent(world);
  neighbour = await addStudent(world);
  await seedRow(student, "2091-03-10", "HADIR", "ADMIN");
  await seedRow(student, "2091-03-11", "TERLAMBAT", "ADMIN", { lateMinutes: 12 });
  await seedRow(student, "2091-03-12", "IZIN", "LEAVE", { leaveRequestId: await seedLeave(student, "2091-03-12", "IZIN") });
  await seedRow(student, "2091-03-13", "SAKIT", "LEAVE", { leaveRequestId: await seedLeave(student, "2091-03-13", "SAKIT") });
  await seedRow(student, "2091-03-14", "ALPHA", "AUTO_ALPHA");
  await seedRow(student, "2091-03-15", "HADIR", "ADMIN");
  await seedRow(student, "2091-03-25", "HADIR", "ADMIN");
  await seedRow(student, "2090-08-03", "ALPHA", "AUTO_ALPHA");
  await seedRow(student, "2090-08-04", "HADIR", "ADMIN");
  for (const date of ["2091-03-10", "2091-03-11", "2091-03-12"]) await seedRow(neighbour, date, "ALPHA", "AUTO_ALPHA");
});
after(disconnect);

const ctxAt = (st: TestStudent, now: Date) => actionContext(studentPrincipal(st), now);

describe("riwayat bulanan (service)", () => {
  test("hari, hari non-sekolah, ringkasan s.d. kemarin, navigasi bulan", async () => {
    const { data, meta } = await getAttendanceMonth({ month: "2091-03" }, ctxAt(student, NOW));
    assert.equal(data.month, "2091-03");
    assert.deepEqual(
      data.days.map((d) => [d.date, d.status, d.source]),
      [
        ["2091-03-10", "HADIR", "ADMIN"],
        ["2091-03-11", "TERLAMBAT", "ADMIN"],
        ["2091-03-12", "IZIN", "LEAVE"],
        ["2091-03-13", "SAKIT", "LEAVE"],
        ["2091-03-14", "ALPHA", "AUTO_ALPHA"],
        ["2091-03-15", "HADIR", "ADMIN"],
        ["2091-03-25", "HADIR", "ADMIN"],
      ],
    );
    assert.equal(data.days[1]?.lateMinutes, 12);
    assert.ok(data.days[2]?.leaveRequestId);
    assert.equal(data.days[0]?.checkInTimeLocal, null);
    assert.equal(data.nonSchoolDays.length, 11);
    assert.deepEqual(data.nonSchoolDays[0], { date: "2091-03-01", reason: "OUTSIDE_TERM", name: null });
    assert.deepEqual(
      data.nonSchoolDays.filter((d) => d.reason === "HOLIDAY"),
      [
        { date: "2091-03-20", reason: "HOLIDAY", name: "Libur Riwayat" },
        { date: "2091-03-21", reason: "HOLIDAY", name: "Libur Riwayat" },
      ],
    );
    assert.deepEqual(data.summary, { recorded: 6, present: 3, late: 1, izin: 1, sakit: 1, alpha: 1, presentPct: 50 });
    assert.deepEqual(meta, { prevMonth: "2091-02", nextMonth: null });
  });

  test("setelah akhir hari sekolah, hari ini ikut dihitung", async () => {
    const { data } = await getAttendanceMonth({}, ctxAt(student, AFTER_DAY_END));
    assert.equal(data.month, "2091-03", "default bulan berjalan");
    assert.deepEqual(data.summary, { recorded: 7, present: 4, late: 1, izin: 1, sakit: 1, alpha: 1, presentPct: 57.1 });
  });

  test("batas bulan: depan & > 24 bulan ke belakang -> 422; tepat 24 bulan -> kosong", async () => {
    await assert.rejects(getAttendanceMonth({ month: "2091-04" }, ctxAt(student, NOW)), { status: 422, code: "MONTH_OUT_OF_RANGE" });
    await assert.rejects(getAttendanceMonth({ month: "2089-02" }, ctxAt(student, NOW)), { status: 422, code: "MONTH_OUT_OF_RANGE" });
    const oldest = await getAttendanceMonth({ month: "2089-03" }, ctxAt(student, NOW));
    assert.deepEqual(oldest.data.days, []);
    assert.deepEqual(oldest.data.summary, { recorded: 0, present: 0, late: 0, izin: 0, sakit: 0, alpha: 0, presentPct: null });
    assert.deepEqual(oldest.meta, { prevMonth: null, nextMonth: "2089-04" });
  });

  test("isolasi: siswa lain di sekolah yang sama hanya melihat catatannya sendiri", async () => {
    const { data } = await getAttendanceMonth({ month: "2091-03" }, ctxAt(neighbour, NOW));
    assert.deepEqual(data.summary, { recorded: 3, present: 0, late: 0, izin: 0, sakit: 0, alpha: 3, presentPct: 0 });
  });
});

describe("ringkasan semester (service)", () => {
  test("default semester yang mencakup hari ini, dipotong di closedThrough", async () => {
    const summary = await getAttendanceSummary({}, ctxAt(student, NOW));
    assert.deepEqual(summary, {
      term: { id: world.termId, label: "Semester Ganjil 2091/2092", startDate: "2091-03-10", endDate: "2091-06-30" },
      recorded: 6, hadir: 2, terlambat: 1, izin: 1, sakit: 1, alpha: 1, presentPct: 50, closedThrough: "2091-03-24",
    });
  });

  test("termId semester lampau milik sekolah sendiri; termId sekolah lain -> 404", async () => {
    const past = await getAttendanceSummary({ termId: pastTermId }, ctxAt(student, NOW));
    assert.equal(past.term.label, "Semester Ganjil 2090/2091");
    assert.deepEqual({ ...past, term: undefined }, { term: undefined, recorded: 2, hadir: 1, terlambat: 0, izin: 0, sakit: 0, alpha: 1, presentPct: 50, closedThrough: "2090-12-20" });
    await assert.rejects(getAttendanceSummary({ termId: other.termId }, ctxAt(student, NOW)), { status: 404 });
  });

  test("semester belum ada hari yang ditutup -> closedThrough null, persentase null", async () => {
    const summary = await getAttendanceSummary({}, ctxAt(student, localInstant("2091-03-10", 400, "WIB")));
    assert.equal(summary.term.id, world.termId);
    assert.equal(summary.recorded, 0);
    assert.equal(summary.presentPct, null);
    assert.equal(summary.closedThrough, null);
  });
});

describe("route riwayat & ringkasan (pipeline HTTP)", () => {
  before(() => mock.timers.enable({ apis: ["Date"], now: NOW.getTime() }));
  after(() => mock.timers.reset());

  const token = async (userId: string, platform: "ANDROID" | "WEB" = "ANDROID") => (await createSessionToken(userId, { platform, deviceId: platform === "WEB" ? null : undefined })).token;
  const getHistory = (bearer: string, query = "") => callRoute<Envelope<{ month: string; summary: { recorded: number } }>>(historyRoute, { method: "GET", url: `/api/v1/student/attendance${query}`, bearer });
  const getSummary = (bearer: string, query = "") => callRoute<Envelope<{ recorded: number; closedThrough: string | null }>>(summaryRoute, { method: "GET", url: `/api/v1/student/attendance/summary${query}`, bearer });

  test("200 dengan meta navigasi; respons lolos validasi kontrak", async () => {
    const bearer = await token(student.user.id);
    const res = await getHistory(bearer, "?month=2091-03");
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    assert.equal(res.body?.data.summary.recorded, 6);
    assert.deepEqual(res.body?.meta, { prevMonth: "2091-02", nextMonth: null });
    const summary = await getSummary(bearer);
    assert.equal(summary.status, 200, JSON.stringify(summary.body?.error));
    assert.equal(summary.body?.data.closedThrough, "2091-03-24");
  });

  test("400 format bulan / termId; 422 bulan depan; 404 termId sekolah lain", async () => {
    const bearer = await token(student.user.id);
    assert.equal((await getHistory(bearer, "?month=2091-13")).status, 400);
    const future = await getHistory(bearer, "?month=2091-04");
    assert.equal(future.status, 422);
    assert.equal(future.body?.error?.code, "MONTH_OUT_OF_RANGE");
    assert.equal((await getSummary(bearer, `?termId=${"x".repeat(65)}`)).status, 400);
    assert.equal((await getSummary(bearer, `?termId=${other.termId}`)).status, 404);
  });

  test("siswa LULUS boleh membaca riwayat; admin sekolah ditolak 403", async () => {
    const graduated = await addStudent(world, { status: "GRADUATED" });
    assert.equal((await getHistory(await token(graduated.user.id))).status, 200);
    assert.equal((await getSummary(await token(graduated.user.id))).status, 200);
    const admin = await createSchoolAdmin(world.school.id);
    const adminToken = await token(admin.id, "WEB");
    assert.equal((await getHistory(adminToken)).status, 403);
    assert.equal((await getSummary(adminToken)).status, 403);
  });
});
