/**
 * Persetujuan / pencatatan izin berpacu dengan penambahan libur: materialisasi membaca kalender lalu
 * menyisipkan baris LEAVE. Tanpa kunci holidays:* (mode bersama) libur yang di-commit di antara keduanya
 * meninggalkan baris LEAVE basi di hari libur (desain 02 §3.8.6 dilanggar). Penahan = gap lock RR pada
 * Attendance(studentId, date) sehingga materialisasi tertahan SETELAH membaca kalender.
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { POST as nationalHolidayRoute } from "@/app/api/v1/platform/holidays/route";
import { POST as schoolHolidayRoute } from "@/app/api/v1/school/holidays/route";
import { POST as approveRoute } from "@/app/api/v1/school/leave-requests/[id]/approve/route";
import { POST as onBehalfRoute } from "@/app/api/v1/school/leave-requests/route";
import { POST as createOwn } from "@/app/api/v1/student/leave-requests/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { Prisma, type Tx } from "@/lib/db";
import { addDays, toDbDate, type LocalDate } from "@/lib/time/zone";
import { pause } from "../../academics/helpers";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { callRoute, type Envelope } from "../../helpers/request";
import {
  callMultipart,
  createLeaveSchool,
  createStudentWithToken,
  freeRun,
  leaveForm,
  leaveUrl,
  superAdminToken,
  useInlineDefer,
  type LeaveSchoolFixture,
  type StudentWithToken,
} from "./helpers";

const STALL_MS = 1_200;
let restoreDefer: () => void = () => undefined;

before(() => {
  restoreDefer = useInlineDefer();
});
beforeEach(() => resetAllLimiters());
after(async () => {
  restoreDefer();
  await disconnect();
});

interface Blocker {
  readonly release: () => Promise<void>;
}

/** Gap lock RR pada (studentId, rentang tanggal): INSERT baris absensi siswa itu menunggu sampai release(). */
async function blockAttendanceInserts(studentId: string, from: LocalDate, to: LocalDate): Promise<Blocker> {
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (open = resolve));
  let locked: () => void = () => undefined;
  const isLocked = new Promise<void>((resolve) => (locked = resolve));
  const done = prisma.$transaction(
    async (tx) => {
      await (tx as Tx).$queryRaw`SELECT id FROM Attendance WHERE studentId = ${studentId} AND date BETWEEN ${toDbDate(from)} AND ${toDbDate(to)} FOR UPDATE`;
      locked();
      await gate;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 40_000 },
  );
  await isLocked;
  return { release: async () => { open(); await done; } };
}

async function submitLeave(st: StudentWithToken, range: { startDate: LocalDate; endDate: LocalDate }): Promise<string> {
  const res = await callMultipart<Envelope<{ id: string }>>(createOwn, { url: "/api/v1/student/leave-requests", form: leaveForm(range), bearer: st.token });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body?.data.id ?? "";
}

const addSchoolHoliday = (fx: LeaveSchoolFixture, date: LocalDate) =>
  callRoute(schoolHolidayRoute, { method: "POST", url: `/api/v1/school/holidays?schoolId=${fx.school.id}`, bearer: fx.adminToken, json: { name: uniq("Libur Balapan"), startDate: date, endDate: date } });

/** Jalankan `write` (tertahan penahan), sisipkan libur selagi tertahan, lepas penahan, tunggu keduanya. */
async function raceWithHoliday(blocker: Blocker, write: () => Promise<{ status: number }>, addHoliday: () => Promise<{ status: number }>) {
  const writing = write();
  await pause(STALL_MS);
  const holiday = addHoliday();
  await pause(STALL_MS);
  await blocker.release();
  const [written, created] = await Promise.all([writing, holiday]);
  assert.ok([200, 201].includes(written.status), `penulisan izin gagal: ${written.status}`);
  assert.equal(created.status, 201);
}

async function derivedRowsOn(studentId: string, date: LocalDate) {
  return prisma.attendance.findMany({ where: { studentId, date: toDbDate(date), source: { in: ["LEAVE", "AUTO_ALPHA"] } }, select: { source: true } });
}

test("persetujuan izin vs libur sekolah baru di tengah rentang -> tidak ada baris LEAVE di hari libur", async () => {
  const fx = await createLeaveSchool();
  const st = await createStudentWithToken(fx);
  const range = await freeRun(10, 3);
  const mid = addDays(range.startDate, 1);
  const leaveId = await submitLeave(st, range);
  const blocker = await blockAttendanceInserts(st.student.id, range.startDate, range.endDate);
  const approve = () => callRoute(approveRoute, { method: "POST", url: leaveUrl(`/${leaveId}/approve`), params: { id: leaveId }, json: {}, bearer: fx.adminToken });
  await raceWithHoliday(blocker, approve, () => addSchoolHoliday(fx, mid));
  assert.deepEqual(await derivedRowsOn(st.student.id, mid), []);
  assert.equal((await derivedRowsOn(st.student.id, range.startDate)).length, 1, "hari lain tetap dimaterialisasi");
});

test("izin dicatat admin vs libur sekolah baru -> tidak ada baris LEAVE di hari libur", async () => {
  const fx = await createLeaveSchool();
  const st = await createStudentWithToken(fx);
  const range = await freeRun(14, 3);
  const mid = addDays(range.startDate, 1);
  const blocker = await blockAttendanceInserts(st.student.id, range.startDate, range.endDate);
  const onBehalf = () =>
    callMultipart(onBehalfRoute, { url: leaveUrl(""), form: leaveForm({ ...range, studentId: st.student.id }), bearer: fx.adminToken });
  await raceWithHoliday(blocker, onBehalf, () => addSchoolHoliday(fx, mid));
  assert.deepEqual(await derivedRowsOn(st.student.id, mid), []);
});

test("persetujuan izin vs libur NASIONAL baru -> tidak ada baris LEAVE di hari libur", async () => {
  const fx = await createLeaveSchool();
  const st = await createStudentWithToken(fx);
  const range = await freeRun(18, 3);
  const mid = addDays(range.startDate, 1);
  const leaveId = await submitLeave(st, range);
  const suToken = await superAdminToken();
  const name = uniq("Libur Nasional Balapan");
  const blocker = await blockAttendanceInserts(st.student.id, range.startDate, range.endDate);
  try {
    const approve = () => callRoute(approveRoute, { method: "POST", url: leaveUrl(`/${leaveId}/approve`), params: { id: leaveId }, json: {}, bearer: fx.adminToken });
    const national = () => callRoute(nationalHolidayRoute, { method: "POST", url: "/api/v1/platform/holidays", bearer: suToken, json: { name, startDate: mid, endDate: mid } });
    await raceWithHoliday(blocker, approve, national);
    assert.deepEqual(await derivedRowsOn(st.student.id, mid), []);
  } finally {
    await prisma.holiday.deleteMany({ where: { schoolId: null, name } });
  }
});
