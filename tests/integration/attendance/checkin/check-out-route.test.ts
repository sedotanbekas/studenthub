/**
 * Absen pulang (permintaan pemilik 2026-10-07): POST /api/v1/student/attendance/check-out + perluasan today/precheck
 * lewat pipeline HTTP penuh. Jam pipeline dikendalikan mock.timers (hanya API Date), sama dengan check-in-route.test.ts.
 * Jadwal default: absen masuk 06:00–10:00, absen pulang mulai 14:00 (School.checkOutOpenMinute = 840). Data tahun 2091.
 */
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { POST as checkInRoute } from "@/app/api/v1/student/attendance/check-in/route";
import { POST as checkOutRoute } from "@/app/api/v1/student/attendance/check-out/route";
import { POST as precheckRoute } from "@/app/api/v1/student/attendance/precheck/route";
import { GET as todayRoute } from "@/app/api/v1/student/attendance/today/route";
import { setStorageDriver } from "@/lib/storage/driver";
import { toDbDate } from "@/lib/time/zone";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin, createStoredFile, type TestStudent } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { callMultipart } from "../../students/helpers";
import { addStudent, checkInForm, createWorld, localInstant, orphanSelfieKeys, precheckBodyAt, solidSelfie, texturedSelfie, type World } from "./fixtures";

interface Today {
  window: { opensAt: string; lateAfter: string; closesAt: string; state: string; checkOutOpensAt: string };
  record: { id: string; status: string; source: string; checkInTimeLocal: string | null; checkOutTimeLocal: string | null } | null;
  canCheckIn: boolean;
  blockReason: string | null;
  canCheckOut: boolean;
  checkOutBlockReason: string | null;
}
interface CheckOutResult {
  attendance: { id: string; date: string; status: string; checkInTimeLocal: string | null; checkOutAt: string; checkOutTimeLocal: string; checkOutDistanceM: number | null };
  message: string;
}
interface Precheck {
  ok: boolean;
  reason: string | null;
  message: string;
  distanceM: number | null;
  radiusM: number;
  window: string;
  wouldBeLate: boolean;
}

const DAY = "2091-04-03";
const HOLIDAY = "2091-04-04";
const CHECK_IN_MINUTE = 430;
const CHECK_OUT_MINUTE = 845;
let storage: TempStorage;
let world: World;
let otherSchool: World;

/** Atur jam pipeline ke menit lokal WIB pada tanggal tertentu. */
const setLocalTime = (minute: number, date = DAY): Date => {
  const instant = localInstant(date, minute, "WIB");
  mock.timers.setTime(instant.getTime());
  return instant;
};

before(async () => {
  mock.timers.enable({ apis: ["Date"], now: localInstant(DAY, CHECK_IN_MINUTE, "WIB").getTime() });
  storage = await createTempStorage();
  setStorageDriver(null);
  world = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  otherSchool = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  await prisma.holiday.create({ data: { schoolId: world.school.id, name: "Libur Uji Pulang", startDate: toDbDate(HOLIDAY), endDate: toDbDate(HOLIDAY) } });
});
after(async () => {
  mock.timers.reset();
  setStorageDriver(null);
  await storage.cleanup();
  await disconnect();
});

/** Token baru setiap kali jam dimajukan (token akses berumur pendek terhadap jam tiruan). */
const tokenOf = async (st: TestStudent, options: Parameters<typeof createSessionToken>[1] = {}): Promise<string> => (await createSessionToken(st.user.id, options)).token;

const getToday = (token: string) => callRoute<Envelope<Today>>(todayRoute, { method: "GET", url: "/api/v1/student/attendance/today", bearer: token });
const postPrecheck = (token: string, json: unknown) =>
  callRoute<Envelope<Precheck>>(precheckRoute, { method: "POST", url: "/api/v1/student/attendance/precheck", bearer: token, json });
const postCheckIn = (token: string, form: FormData) => callMultipart<Envelope>(checkInRoute, { url: "/api/v1/student/attendance/check-in", form, bearer: token });
const postCheckOut = (token: string, form: FormData) =>
  callMultipart<Envelope<CheckOutResult>>(checkOutRoute, { url: "/api/v1/student/attendance/check-out", form, bearer: token });

/** Siswa yang sudah absen masuk pukul 07:10 pada tanggal `date`. */
async function checkedInStudent(target: World = world, date = DAY): Promise<TestStudent> {
  const st = await addStudent(target);
  const now = setLocalTime(CHECK_IN_MINUTE, date);
  const res = await postCheckIn(await tokenOf(st), checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  return st;
}

const checkOutColumns = (studentId: string) =>
  prisma.attendance.findFirstOrThrow({
    where: { studentId },
    select: { id: true, status: true, checkInAt: true, checkOutAt: true, checkOutLatitude: true, checkOutAccuracyM: true, checkOutDistanceM: true, checkOutDeviceId: true, checkOutSelfieFileId: true, selfieFileId: true },
  });

test("alur lengkap: today (belum dibuka) -> precheck pulang -> check-out 201 -> today sudah pulang -> percobaan kedua 409", async () => {
  const st = await checkedInStudent();
  const morning = (await getToday(await tokenOf(st))).body!.data;
  assert.equal(morning.window.checkOutOpensAt, "14:00");
  assert.equal(morning.canCheckOut, false);
  assert.equal(morning.checkOutBlockReason, "CHECKOUT_NOT_OPEN");
  assert.equal(morning.record?.checkOutTimeLocal, null);

  const now = setLocalTime(CHECK_OUT_MINUTE);
  const token = await tokenOf(st);
  const before = (await getToday(token)).body!.data;
  assert.equal(before.canCheckOut, true);
  assert.equal(before.checkOutBlockReason, null);
  const precheck = await postPrecheck(token, { ...precheckBodyAt(now), purpose: "CHECK_OUT" });
  assert.equal(precheck.status, 200, JSON.stringify(precheck.body?.error));
  assert.deepEqual({ ...precheck.body?.data, message: "" }, { ok: true, reason: null, message: "", distanceM: 20, radiusM: 150, window: "OPEN", wouldBeLate: false });

  const created = await postCheckOut(token, checkInForm(now, await texturedSelfie()));
  assert.equal(created.status, 201, JSON.stringify(created.body?.error));
  assert.deepEqual(created.body?.data.attendance, {
    id: created.body?.data.attendance.id,
    date: DAY,
    status: "HADIR",
    checkInTimeLocal: "07:10",
    checkOutAt: now.toISOString(),
    checkOutTimeLocal: "14:05",
    checkOutDistanceM: 20,
  });
  assert.match(created.body?.data.message ?? "", /pulang pukul 14:05/);

  const row = await checkOutColumns(st.student.id);
  assert.equal(row.status, "HADIR", "status hadir tidak berubah");
  assert.equal(row.checkOutAt?.toISOString(), now.toISOString());
  assert.equal(row.checkOutAccuracyM, 12);
  assert.equal(row.checkOutDistanceM, 20);
  assert.equal(row.checkOutDeviceId, "device-test-0001");
  assert.ok(row.checkOutLatitude);
  assert.ok(row.checkOutSelfieFileId && row.checkOutSelfieFileId !== row.selfieFileId);
  const file = await prisma.storedFile.findFirstOrThrow({ where: { id: row.checkOutSelfieFileId ?? "" } });
  assert.equal(file.kind, "ATTENDANCE_SELFIE");
  assert.equal(file.schoolId, world.school.id);
  assert.equal(file.uploadedById, st.user.id);

  const afterOut = (await getToday(token)).body!.data;
  assert.equal(afterOut.record?.checkOutTimeLocal, "14:05");
  assert.equal(afterOut.canCheckOut, false);
  assert.equal(afterOut.checkOutBlockReason, "ALREADY_CHECKED_OUT");

  const later = setLocalTime(CHECK_OUT_MINUTE + 30);
  const again = await postCheckOut(await tokenOf(st), checkInForm(later, await texturedSelfie()));
  assert.equal(again.status, 409);
  assert.equal(again.body?.error?.code, "ALREADY_CHECKED_OUT");
  assert.deepEqual(again.body?.error?.details, { checkOutTimeLocal: "14:05" });
  assert.equal((await checkOutColumns(st.student.id)).checkOutAt?.toISOString(), now.toISOString(), "jam pulang pertama dipertahankan");
  assert.equal(await prisma.storedFile.count({ where: { uploadedById: st.user.id } }), 2, "selfie kedua dibuang");
  assert.deepEqual(await orphanSelfieKeys(storage.root), []);
});

test("belum absen masuk -> 422 NOT_CHECKED_IN (tanpa baris / catatan admin Sakit); precheck pulang ikut menolak", async () => {
  const now = setLocalTime(CHECK_OUT_MINUTE);
  const st = await addStudent(world);
  const token = await tokenOf(st);
  const today = (await getToday(token)).body!.data;
  assert.equal(today.canCheckOut, false);
  assert.equal(today.checkOutBlockReason, "NOT_CHECKED_IN");
  const res = await postCheckOut(token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "NOT_CHECKED_IN");
  const precheck = await postPrecheck(token, { ...precheckBodyAt(now), purpose: "CHECK_OUT" });
  assert.equal(precheck.body?.data.ok, false);
  assert.equal(precheck.body?.data.reason, "NOT_CHECKED_IN");
  assert.equal(precheck.body?.data.distanceM, null);

  const sick = await addStudent(world);
  await prisma.attendance.create({ data: { schoolId: world.school.id, studentId: sick.student.id, date: toDbDate(DAY), status: "SAKIT", source: "ADMIN" } });
  const sickRes = await postCheckOut(await tokenOf(sick), checkInForm(now, await solidSelfie()));
  assert.equal(sickRes.body?.error?.code, "NOT_CHECKED_IN");
  assert.equal(await prisma.storedFile.count({ where: { uploadedById: { in: [st.user.id, sick.user.id] } } }), 0);
});

test("sebelum jam absen pulang -> 422 CHECKOUT_NOT_OPEN {opensAt}; tidak menulis apa pun", async () => {
  const st = await checkedInStudent();
  const now = setLocalTime(839);
  const res = await postCheckOut(await tokenOf(st), checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "CHECKOUT_NOT_OPEN");
  assert.deepEqual(res.body?.error?.details, { opensAt: "14:00" });
  assert.equal(res.body?.error?.message, "Absen pulang belum dibuka. Absen pulang dibuka pukul 14:00.");
  assert.equal((await checkOutColumns(st.student.id)).checkOutAt, null);
  assert.equal(await prisma.storedFile.count({ where: { uploadedById: st.user.id } }), 1);
});

test("jam absen pulang mengikuti pengaturan sekolah (checkOutOpenMinute)", async () => {
  const early = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  await prisma.school.update({ where: { id: early.school.id }, data: { checkOutOpenMinute: 600 } });
  const st = await checkedInStudent(early);
  const now = setLocalTime(610);
  const token = await tokenOf(st);
  assert.equal((await getToday(token)).body?.data.window.checkOutOpensAt, "10:00");
  const res = await postCheckOut(token, checkInForm(now, await texturedSelfie()));
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.attendance.checkOutTimeLocal, "10:10");
});

test("di luar geofence / lokasi palsu -> 422 seperti check-in; percobaan pulang tidak dicatat sebagai CheckInRejection", async () => {
  const st = await checkedInStudent();
  const now = setLocalTime(CHECK_OUT_MINUTE);
  const token = await tokenOf(st);
  const outside = await postCheckOut(token, checkInForm(now, await solidSelfie(), { meters: 412 }));
  assert.equal(outside.status, 422);
  assert.equal(outside.body?.error?.code, "OUTSIDE_GEOFENCE");
  assert.deepEqual(outside.body?.error?.details, { distanceM: 412, radiusM: 150 });
  const mocked = await postCheckOut(token, checkInForm(now, await solidSelfie(), { mocked: true }));
  assert.equal(mocked.body?.error?.code, "MOCK_LOCATION");
  const precheck = await postPrecheck(token, { ...precheckBodyAt(now, { meters: 800 }), purpose: "CHECK_OUT" });
  assert.equal(precheck.body?.data.reason, "OUTSIDE_GEOFENCE");
  assert.equal(precheck.body?.data.distanceM, 800);
  assert.equal(await prisma.checkInRejection.count({ where: { studentId: st.student.id } }), 0);
  assert.equal((await checkOutColumns(st.student.id)).checkOutAt, null);
});

test("hari libur: today NOT_SCHOOL_DAY untuk pulang; POST 422 NOT_SCHOOL_DAY (catatan absen masuk disisipkan langsung)", async () => {
  const st = await addStudent(world);
  const selfie = await createStoredFile(st.user.id, "ATTENDANCE_SELFIE", { schoolId: world.school.id });
  await prisma.attendance.create({
    data: {
      schoolId: world.school.id, studentId: st.student.id, date: toDbDate(HOLIDAY), status: "HADIR", source: "CHECKIN",
      checkInAt: localInstant(HOLIDAY, CHECK_IN_MINUTE, "WIB"), latitude: "-6.9147000", longitude: "107.6098000", selfieFileId: selfie.id,
    },
  });
  const now = setLocalTime(CHECK_OUT_MINUTE, HOLIDAY);
  const token = await tokenOf(st);
  assert.equal((await getToday(token)).body?.data.checkOutBlockReason, "NOT_SCHOOL_DAY");
  const res = await postCheckOut(token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "NOT_SCHOOL_DAY");
});

test("sesi WEB / tanpa deviceId -> 403 CHECKIN_MOBILE_ONLY tanpa menulis apa pun; admin sekolah 403", async () => {
  const st = await checkedInStudent();
  const now = setLocalTime(CHECK_OUT_MINUTE);
  for (const options of [{ platform: "WEB" as const, deviceId: null }, { platform: "ANDROID" as const, deviceId: null }]) {
    const res = await postCheckOut(await tokenOf(st, options), checkInForm(now, await solidSelfie()));
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "CHECKIN_MOBILE_ONLY");
  }
  const admin = await createSchoolAdmin(world.school.id);
  const adminRes = await postCheckOut((await createSessionToken(admin.id, { platform: "WEB", deviceId: null })).token, checkInForm(now, await solidSelfie()));
  assert.equal(adminRes.status, 403);
  assert.equal((await checkOutColumns(st.student.id)).checkOutAt, null);
  assert.equal(await prisma.storedFile.count({ where: { uploadedById: st.user.id } }), 1);
});

test("IDOR: siswa hanya bisa absen pulang untuk catatannya sendiri; id siswa dari body ditolak 400", async () => {
  const b = await checkedInStudent();
  const foreign = await checkedInStudent(otherSchool);
  const a = await addStudent(world);
  const now = setLocalTime(CHECK_OUT_MINUTE);
  const tokenA = await tokenOf(a);
  const res = await postCheckOut(tokenA, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "NOT_CHECKED_IN");
  const extras: Record<string, string>[] = [{ studentId: b.student.id }, { attendanceId: (await checkOutColumns(b.student.id)).id }];
  for (const extra of extras) {
    const bad = await postCheckOut(tokenA, checkInForm(now, await solidSelfie(), { extra }));
    assert.equal(bad.status, 400, JSON.stringify(extra));
    assert.equal(bad.body?.error?.code, "VALIDATION_FAILED");
  }
  assert.equal((await checkOutColumns(b.student.id)).checkOutAt, null);
  assert.equal((await checkOutColumns(foreign.student.id)).checkOutAt, null);
  assert.equal(await prisma.attendance.count({ where: { studentId: a.student.id } }), 0);
});
