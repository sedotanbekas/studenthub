/**
 * Pengingat absen (N5): satu push-only per siswa per hari sekolah di jendela [jam masuk - lead, jam masuk - 1),
 * hanya siswa wajib absen yang belum absen, tanpa izin PENDING/DISETUJUI, dan punya perangkat; kedaluwarsa di batas
 * hadir; tepat sekali (JobRun + dedupKey); hari non-sekolah/mask/jadwal bawaan/mati -> tidak ada; mode uji tidak
 * berpengaruh; sapuan menandai yang sudah absen OBSOLETE.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { School } from "@prisma/client";
import { runAttendanceReminders, sendSchoolReminders, REMINDER_SCHOOL_SELECT } from "@/lib/attendance/reminder-job";
import { sweepCheckedInReminders } from "@/lib/attendance/reminder-expiry";
import { ATTENDANCE_REMINDER_JOB, reminderSlot } from "@/lib/attendance/reminder-rules";
import { setAttendanceTestMode, isAttendanceTestMode } from "@/lib/attendance/test-mode";
import { notifyRecipients } from "@/lib/notifications/notify";
import { attendanceReminderEvent } from "@/lib/notifications/templates/attendance-reminder";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createStudent } from "../../helpers/factories";
import { addDevice } from "../../push/helpers";
import { actionCtx, checkInRow, createAttendanceSchool, jobCtx, leaveRequest, nationalHolidayDates } from "./fixtures";

/** Selasa 18 Maret 2031; 06:50 WIB = 23:50Z hari sebelumnya. Jam masuk 07:00, toleransi 15. */
const D = "2031-03-18";
const IN_WINDOW = new Date("2031-03-17T23:50:00Z");
const TERM = { termStart: "2031-01-06", termEnd: "2031-06-20" } as const;
const DEVICE_EXPIRY = new Date("2031-04-30T00:00:00Z");
const ACTIVATED = new Date("2031-01-10T00:00:00Z");

before(async () => {
  assert.equal((await nationalHolidayDates("2031-03-15", "2031-03-23")).size, 0, "DB uji tidak boleh punya libur nasional di rentang test ini");
});
after(disconnect);

/** Jadwal SUDAH diatur (dayEnd bukan bawaan), Senin–Jumat. */
const school = (data: Record<string, unknown> = {}) =>
  createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM, data: { schoolDaysMask: 31, dayEndMinute: 960, ...data } });

async function student(schoolId: string, options: { device?: boolean; activatedAt?: Date; isActive?: boolean; status?: "ACTIVE" | "INACTIVE" } = {}) {
  const st = await createStudent(schoolId, { activatedAt: options.activatedAt ?? ACTIVATED, isActive: options.isActive, status: options.status });
  if (options.device !== false) await addDevice(st.user.id, "live", { expiresAt: DEVICE_EXPIRY });
  return st;
}

const reminders = (userIds: readonly string[]) => prisma.notification.findMany({ where: { userId: { in: [...userIds] }, type: "ATTENDANCE_REMINDER" } });
const runs = (schoolId: string) => prisma.jobRun.findMany({ where: { job: ATTENDANCE_REMINDER_JOB, scopeKey: schoolId } });
const tick = (s: School, now = IN_WINDOW) => runAttendanceReminders(jobCtx(now, { schoolIds: [s.id] }));

test("di jendela: satu baris push-only per siswa (sudah dibaca, PENDING, kedaluwarsa di batas hadir), JobRun SUCCEEDED; tick kedua tanpa baris baru", async () => {
  const s = await school();
  const a = await student(s.id);
  const summary = await tick(s);
  assert.equal(summary.ran, 1);
  const [row] = await reminders([a.user.id]);
  assert.ok(row?.readAt, "push-only: langsung dibaca");
  assert.equal(row?.pushStatus, "PENDING");
  assert.equal(row?.pushExpiresAt?.toISOString(), "2031-03-18T00:15:00.000Z");
  assert.deepEqual(row?.data, { screen: "check-in", id: D });
  assert.equal(row?.dedupKey, `attendance-reminder:${D}`);
  assert.equal(row?.body, "Jam masuk 07:00. Absen begitu tiba di sekolah, paling lambat 07:15 agar tercatat hadir.");
  const [run] = await runs(s.id);
  assert.equal(run?.status, "SUCCEEDED");
  assert.equal(run?.runKey, D);
  assert.deepEqual(run?.result, { date: D, candidates: 1, unreachable: 0, recipients: 1, created: 1, obsolete: 0 });

  await tick(s, new Date(IN_WINDOW.getTime() + 120_000));
  assert.equal((await reminders([a.user.id])).length, 1);
  assert.equal((await runs(s.id)).length, 1);
});

test("dilewati: sudah absen, siswa nonaktif, akun nonaktif, izin PENDING/DISETUJUI, tanpa perangkat, aktif setelah batas; kontrol positif menerima", async () => {
  const s = await school();
  const control = await student(s.id);
  const checkedIn = await student(s.id);
  await checkInRow({ schoolId: s.id, studentId: checkedIn.student.id, userId: checkedIn.user.id, date: D, deviceId: uniq("dev") });
  const others = [
    await student(s.id, { status: "INACTIVE" }),
    await student(s.id, { isActive: false }),
    await student(s.id, { device: false }),
    await student(s.id, { activatedAt: new Date("2031-03-18T03:30:00Z") }),
  ];
  const [pending, approved] = [await student(s.id), await student(s.id)];
  await leaveRequest({ schoolId: s.id, studentId: pending.student.id, from: D, to: D, status: "PENDING" });
  await leaveRequest({ schoolId: s.id, studentId: approved.student.id, from: "2031-03-17", to: "2031-03-19", status: "APPROVED" });
  await tick(s);
  const users = [control, checkedIn, pending, approved, ...others].map((x) => x.user.id);
  assert.deepEqual((await reminders(users)).map((r) => r.userId), [control.user.id]);
});

test("di luar jendela (06:44, 06:59, 07:30), Sabtu (mask 31), hari libur, pengingat mati, jadwal bawaan -> tidak ada", async () => {
  const s = await school();
  const a = await student(s.id);
  for (const iso of ["2031-03-17T23:44:00Z", "2031-03-17T23:59:00Z", "2031-03-18T00:30:00Z", "2031-03-21T23:50:00Z"]) await tick(s, new Date(iso));
  assert.equal((await runs(s.id)).length, 0);

  const holiday = await school();
  await student(holiday.id);
  await prisma.holiday.create({ data: { schoolId: holiday.id, name: uniq("Libur"), startDate: toDbDate(D), endDate: toDbDate(D) } });
  await tick(holiday);
  assert.deepEqual((await runs(holiday.id))[0]?.result, { date: D, skipped: "NON_SCHOOL_DAY", reason: "HOLIDAY" });

  const off = await school({ attendanceReminderEnabled: false });
  const untouched = await createAttendanceSchool({ createdAt: new Date("2031-01-01T00:00:00Z"), ...TERM, data: { schoolDaysMask: 31 } });
  const users = [await student(off.id), await student(untouched.id)];
  await tick(off);
  await tick(untouched);
  assert.equal((await runs(off.id)).length + (await runs(untouched.id)).length, 0, "mati / jadwal bawaan tidak pernah jatuh tempo");
  assert.equal((await reminders([a.user.id, ...users.map((u) => u.user.id)])).length, 0);
});

test("lead 120 -> jendela mulai jam buka absen (06:00); WIT memakai tanggal lokal", async () => {
  const early = await school({ attendanceReminderLeadMinutes: 120 });
  const a = await student(early.id);
  await tick(early, new Date("2031-03-17T23:05:00Z"));
  assert.equal((await reminders([a.user.id])).length, 1);

  const wit = await school({ timezone: "WIT" });
  const b = await student(wit.id);
  await tick(wit, new Date("2031-03-17T21:50:00Z"));
  assert.equal((await runs(wit.id))[0]?.runKey, D);
  assert.equal((await reminders([b.user.id])).length, 1);
});

test("mode uji absensi tidak berpengaruh: hari libur tetap tanpa pengingat", async () => {
  const before = await isAttendanceTestMode();
  try {
    await setAttendanceTestMode(true, actionCtx(IN_WINDOW));
    const s = await school();
    const a = await student(s.id);
    await prisma.holiday.create({ data: { schoolId: s.id, name: uniq("Libur"), startDate: toDbDate(D), endDate: toDbDate(D) } });
    await tick(s);
    assert.equal((await reminders([a.user.id])).length, 0);
  } finally {
    await setAttendanceTestMode(before, actionCtx());
  }
});

test("dedupKey: dua penulisan langsung untuk tanggal sama tetap satu baris; sapuan menandai yang sudah absen OBSOLETE", async () => {
  const s = await school();
  const [a, b] = [await student(s.id), await student(s.id)];
  const row = await prisma.school.findUniqueOrThrow({ where: { id: s.id }, select: REMINDER_SCHOOL_SELECT });
  const slot = reminderSlot(IN_WINDOW, row)!;
  await sendSchoolReminders(row, slot, { now: IN_WINDOW });
  await sendSchoolReminders(row, slot, { now: new Date(IN_WINDOW.getTime() + 1_000) });
  assert.equal((await reminders([a.user.id])).length, 1);

  await checkInRow({ schoolId: s.id, studentId: b.student.id, userId: b.user.id, date: D, deviceId: uniq("dev") });
  const swept = await withTx((tx) => sweepCheckedInReminders(tx, s.id, D, [a.user.id, b.user.id]));
  assert.equal(swept, 1);
  const [bRow] = await reminders([b.user.id]);
  assert.deepEqual([bRow?.pushStatus, bRow?.pushError], ["SKIPPED", "OBSOLETE"]);
  const [aRow] = await reminders([a.user.id]);
  assert.equal(aRow?.pushStatus, "PENDING");
});

test("baris push-only tidak menaikkan badge dan tidak tampil di kotak masuk", async () => {
  const s = await school();
  const a = await student(s.id);
  await withTx((tx) => notifyRecipients(tx, [{ userId: a.user.id, role: "STUDENT" }], attendanceReminderEvent({ date: D, startMinute: 420, lateToleranceMinutes: 15, expiresAt: new Date("2031-03-18T00:15:00Z") }), { now: IN_WINDOW }));
  assert.equal(await prisma.notification.count({ where: { userId: a.user.id, readAt: null } }), 0);
});
