/**
 * Notifikasi saat hari sekolah ditutup (N4): Alpa ke siswa (<= 3 hari) & rekap ke admin (<= 1 hari), sekali per
 * tanggal per penerima (dedupKey), saringan kategori admin (N2), anomali tertinjau tidak dihitung (B1), Alpa massal
 * tanpa check-in ditahan, hari non-sekolah/disegel tanpa notifikasi.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { NotificationType, Prisma, School } from "@prisma/client";
import { closeSchoolDay, runAutoAlpha } from "@/lib/attendance/auto-alpha-job";
import { AUTO_ALPHA_JOB, sealedCloseResult } from "@/lib/attendance/auto-alpha-rules";
import { toInboxItemDto } from "@/lib/notifications/dto";
import { initialPushStatus } from "@/lib/notifications/rules";
import { ALPHA_HOLD_LINE } from "@/lib/notifications/templates/attendance-day";
import { eachDate, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createSchoolAdmin, createStudent, createSuperAdmin } from "../../helpers/factories";
import { checkInRow, createAttendanceSchool, jobCtx, leaveRequest, nationalHolidayDates, type CheckInRowInput } from "./fixtures";

/** Selasa 18 Maret 2031 09:00Z = 16:00 WIB (lewat dayEnd 15:00). */
const D = "2031-03-18";
const NOW = new Date("2031-03-18T09:00:00Z");
const TERM = { termStart: "2031-01-06", termEnd: "2031-06-20" } as const;
const ACTIVATED = new Date("2031-01-10T00:00:00Z");
const LOGGED_IN = new Date("2031-03-01T00:00:00Z");

before(async () => {
  assert.equal((await nationalHolidayDates("2031-03-08", "2031-03-20")).size, 0, "DB uji tidak boleh punya libur nasional di rentang test ini");
});
after(disconnect);

const schoolOnD = () => createAttendanceSchool({ createdAt: new Date(`${D}T00:00:00Z`), ...TERM });

type Student = Awaited<ReturnType<typeof createStudent>>;

/** Siswa layak absen; default pernah masuk (akun yang belum pernah masuk tidak diberi notifikasi). */
async function student(schoolId: string, options: { loggedIn?: boolean; isActive?: boolean } = {}): Promise<Student> {
  const st = await createStudent(schoolId, { activatedAt: ACTIVATED, isActive: options.isActive });
  if (options.loggedIn === false) return st;
  return { ...st, user: await prisma.user.update({ where: { id: st.user.id }, data: { lastLoginAt: LOGGED_IN } }) };
}

async function admin(schoolId: string, options: { primary?: boolean; isActive?: boolean } = {}) {
  const user = await createSchoolAdmin(schoolId, { isActive: options.isActive });
  return prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: LOGGED_IN, ...(options.primary ? { primarySchoolId: schoolId } : {}) } });
}

const checkIn = (schoolId: string, st: Student, date = D, extra: Partial<CheckInRowInput> = {}) =>
  checkInRow({ schoolId, studentId: st.student.id, userId: st.user.id, date, deviceId: uniq("dev"), ...extra });

const close = (school: School, now = NOW) => closeSchoolDay(school, D, jobCtx(now, { schoolIds: [school.id] }));

const notices = (userIds: readonly string[], type: NotificationType) =>
  prisma.notification.findMany({ where: { userId: { in: [...userIds] }, type }, orderBy: [{ userId: "asc" }, { dedupKey: "asc" }] });

const recipientsOf = async (userIds: readonly string[], type: NotificationType) => (await notices(userIds, type)).map((n) => n.userId).sort();

test("tutup hari: tiap siswa Alpa yang pernah masuk mendapat tepat satu notifikasi; check-in, izin, akun nonaktif & belum pernah masuk tidak", async () => {
  const school = await schoolOnD();
  const primary = await admin(school.id, { primary: true });
  const [a, b, present, onLeave] = [await student(school.id), await student(school.id), await student(school.id), await student(school.id)];
  const [inactive, dormant] = [await student(school.id, { isActive: false }), await student(school.id, { loggedIn: false })];
  await checkIn(school.id, present);
  await leaveRequest({ schoolId: school.id, studentId: onLeave.student.id, from: D, to: D, status: "APPROVED", type: "SAKIT" });
  await close(school);

  const everyone = [a, b, present, onLeave, inactive, dormant].map((s) => s.user.id);
  const rows = await notices(everyone, "ATTENDANCE_ALPHA");
  assert.deepEqual(rows.map((r) => r.userId).sort(), [a.user.id, b.user.id].sort());
  const first = rows[0]!;
  assert.equal(first.category, "ATTENDANCE");
  assert.equal(first.pushStatus, "PENDING");
  assert.equal(first.dedupKey, "attendance-alpha:2031-03-18");
  assert.equal(first.title, "Alpa pada Selasa, 18 Maret");
  assert.deepEqual(first.data, { screen: "attendance-alpha", id: D });
  assert.equal(toInboxItemDto(first).type, "ATTENDANCE_ALPHA", "nilai ENUM baru terbaca balik");
  assert.equal(await prisma.attendance.count({ where: { schoolId: school.id, date: toDbDate(D), source: "AUTO_ALPHA" } }), 4, "Alpa tetap tercatat untuk semua");

  const [summary] = await notices([primary.id], "ATTENDANCE_DAY_SUMMARY");
  assert.equal(summary?.body, "Alpa 4 · Terlambat 0 · Izin 0 · Sakit 1.");
  assert.equal(summary?.pushStatus, initialPushStatus("SCHOOL_ADMIN"));
  assert.equal(toInboxItemDto(summary!).category, "ATTENDANCE");
});

test("izin PENDING yang mencakup tanggal -> teks sebab-akibat + tautan pengajuan; izin DISETUJUI -> LEAVE tanpa notifikasi", async () => {
  const school = await schoolOnD();
  const [pending, approved, present] = [await student(school.id), await student(school.id), await student(school.id)];
  const leave = await leaveRequest({ schoolId: school.id, studentId: pending.student.id, from: "2031-03-17", to: "2031-03-19", status: "PENDING", type: "SAKIT" });
  await leaveRequest({ schoolId: school.id, studentId: approved.student.id, from: D, to: D, status: "APPROVED" });
  await checkIn(school.id, present);
  await close(school);

  const [notice] = await notices([pending.user.id], "ATTENDANCE_ALPHA");
  assert.match(notice?.body ?? "", /karena pengajuan sakit kamu belum disetujui/);
  assert.deepEqual(notice?.data, { screen: "leave-request", id: leave.id });
  assert.equal(notice?.dedupKey, "attendance-alpha:2031-03-18");
  assert.deepEqual(await recipientsOf([approved.user.id], "ATTENDANCE_ALPHA"), []);
});

test("tutup ulang, tutup bersamaan, dan draf yang ditulis lagi tidak pernah menggandakan notifikasi", async () => {
  const school = await schoolOnD();
  const primary = await admin(school.id, { primary: true });
  const [a, present] = [await student(school.id), await student(school.id)];
  await checkIn(school.id, present);
  await Promise.all([close(school), close(school)]);
  await close(school, new Date(NOW.getTime() + 60_000));
  // Draf dibuat ulang (baris Alpa dihapus lalu ditutup lagi): notifikasi tanggal yang sama diredam dedupKey.
  await prisma.attendance.deleteMany({ where: { schoolId: school.id, source: "AUTO_ALPHA" } });
  await close(school, new Date(NOW.getTime() + 120_000));
  assert.equal(await prisma.attendance.count({ where: { schoolId: school.id, source: "AUTO_ALPHA" } }), 1);
  assert.equal((await notices([a.user.id], "ATTENDANCE_ALPHA")).length, 1);
  assert.equal((await notices([primary.id], "ATTENDANCE_DAY_SUMMARY")).length, 1);
});

test("catch-up tick: Alpa hanya untuk tanggal <= 3 hari lalu, rekap hanya hari ini & kemarin", async () => {
  const school = await createAttendanceSchool({ createdAt: new Date("2031-03-10T00:00:00Z"), ...TERM });
  const primary = await admin(school.id, { primary: true });
  const [a, present] = [await student(school.id), await student(school.id)];
  for (const date of eachDate("2031-03-10", D)) await checkIn(school.id, present, date);
  await runAutoAlpha(jobCtx(NOW, { schoolIds: [school.id] }));

  assert.ok((await prisma.attendance.count({ where: { studentId: a.student.id, source: "AUTO_ALPHA" } })) > 4, "tanggal lama tetap ditutup");
  const alpha = await notices([a.user.id], "ATTENDANCE_ALPHA");
  assert.deepEqual(alpha.map((n) => n.dedupKey), ["2031-03-15", "2031-03-16", "2031-03-17", D].map((d) => `attendance-alpha:${d}`));
  const summaries = await notices([primary.id], "ATTENDANCE_DAY_SUMMARY");
  assert.deepEqual(summaries.map((n) => n.dedupKey), ["attendance-summary:2031-03-17", `attendance-summary:${D}`]);
});

test("rekap admin: angka tepat, anomali tertinjau tidak dihitung; admin aktif sekolah itu saja", async () => {
  const school = await schoolOnD();
  const elsewhere = await schoolOnD();
  const [primary, extra] = [await admin(school.id, { primary: true }), await admin(school.id)];
  const outsiders = [(await admin(school.id, { isActive: false })).id, (await admin(elsewhere.id, { primary: true })).id, (await createSuperAdmin({ totp: false })).id];
  const [, late, reviewedSt, izin, sakit] = [await student(school.id), await student(school.id), await student(school.id), await student(school.id), await student(school.id)];
  await checkIn(school.id, late, D, { status: "TERLAMBAT", lateMinutes: 12, anomalyFlags: ["NEW_DEVICE"], hasAnomaly: true });
  const reviewed = await checkIn(school.id, reviewedSt, D, { anomalyFlags: ["NEW_DEVICE"], hasAnomaly: true });
  await prisma.attendance.update({ where: { id: reviewed.id }, data: { anomalyReviewDecision: "VALID", anomalyReviewedAt: NOW, anomalyReviewedById: primary.id } });
  await leaveRequest({ schoolId: school.id, studentId: izin.student.id, from: D, to: D, status: "APPROVED", type: "IZIN" });
  await leaveRequest({ schoolId: school.id, studentId: sakit.student.id, from: D, to: D, status: "APPROVED", type: "SAKIT" });
  await close(school);

  assert.deepEqual(await recipientsOf([primary.id, extra.id, ...outsiders], "ATTENDANCE_DAY_SUMMARY"), [primary.id, extra.id].sort());
  const [summary] = await notices([primary.id], "ATTENDANCE_DAY_SUMMARY");
  assert.equal(summary?.title, "Rekap kehadiran Selasa, 18 Maret 2031");
  assert.equal(summary?.body, "Alpa 1 · Terlambat 1 · Izin 1 · Sakit 1. 1 perlu ditinjau.");
  assert.deepEqual(summary?.data, { screen: "attendance-day", id: D });
});

test("hari tanpa Alpa/terlambat/anomali (hanya hadir & izin) -> tanpa rekap dan tanpa notifikasi Alpa", async () => {
  const school = await schoolOnD();
  const primary = await admin(school.id, { primary: true });
  const [present, izin] = [await student(school.id), await student(school.id)];
  await checkIn(school.id, present);
  await leaveRequest({ schoolId: school.id, studentId: izin.student.id, from: D, to: D, status: "APPROVED" });
  await close(school);
  assert.equal((await notices([primary.id], "ATTENDANCE_DAY_SUMMARY")).length, 0);
  assert.equal((await notices([present.user.id, izin.user.id], "ATTENDANCE_ALPHA")).length, 0);
});

test("N2: admin yang mematikan Kehadiran tidak menerima rekap; mematikan Kesiswaan tidak berpengaruh; semua mematikan -> admin utama", async () => {
  const school = await schoolOnD();
  const [primary, quiet, studentAffairsOnly] = [await admin(school.id, { primary: true }), await admin(school.id), await admin(school.id)];
  await prisma.notificationMute.createMany({ data: [{ userId: quiet.id, category: "ATTENDANCE" }, { userId: studentAffairsOnly.id, category: "STUDENT_AFFAIRS" }] });
  await student(school.id);
  await checkIn(school.id, await student(school.id));
  await close(school);
  assert.deepEqual(await recipientsOf([primary.id, quiet.id, studentAffairsOnly.id], "ATTENDANCE_DAY_SUMMARY"), [primary.id, studentAffairsOnly.id].sort());

  const all = await schoolOnD();
  const [primary2, other] = [await admin(all.id, { primary: true }), await admin(all.id)];
  await prisma.notificationMute.createMany({ data: [primary2.id, other.id].map((userId) => ({ userId, category: "ATTENDANCE" as const })) });
  await student(all.id);
  await checkIn(all.id, await student(all.id));
  await close(all);
  assert.deepEqual(await recipientsOf([primary2.id, other.id], "ATTENDANCE_DAY_SUMMARY"), [primary2.id]);
});

test("tanpa satu pun check-in: notifikasi Alpa ke siswa ditahan, admin menerima rekap dengan kalimat penahanan", async () => {
  const school = await schoolOnD();
  const primary = await admin(school.id, { primary: true });
  const [a, b] = [await student(school.id), await student(school.id)];
  await close(school);
  assert.equal(await prisma.attendance.count({ where: { schoolId: school.id, source: "AUTO_ALPHA" } }), 2);
  assert.equal((await notices([a.user.id, b.user.id], "ATTENDANCE_ALPHA")).length, 0);
  const [summary] = await notices([primary.id], "ATTENDANCE_DAY_SUMMARY");
  assert.equal(summary?.body, `Alpa 2 · Terlambat 0 · Izin 0 · Sakit 0. ${ALPHA_HOLD_LINE}`);
});

test("hari libur dan hari yang disegel -> tanpa notifikasi apa pun", async () => {
  const holiday = await schoolOnD();
  const sealed = await schoolOnD();
  const admins = [(await admin(holiday.id, { primary: true })).id, (await admin(sealed.id, { primary: true })).id];
  const students = [await student(holiday.id), await student(sealed.id)];
  await prisma.holiday.create({ data: { schoolId: holiday.id, name: uniq("Libur"), startDate: toDbDate(D), endDate: toDbDate(D) } });
  const result = sealedCloseResult(D) as unknown as Prisma.InputJsonObject;
  await prisma.jobRun.create({ data: { job: AUTO_ALPHA_JOB, scopeKey: sealed.id, runKey: D, status: "SUCCEEDED", startedAt: NOW, result } });
  await close(holiday);
  await close(sealed);
  assert.equal(await prisma.notification.count({ where: { userId: { in: [...admins, ...students.map((s) => s.user.id)] } } }), 0);
});
