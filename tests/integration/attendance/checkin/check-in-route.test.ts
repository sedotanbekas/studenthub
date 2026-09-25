/**
 * Endpoint /api/v1/student/attendance/{today,precheck,check-in} lewat pipeline HTTP penuh.
 * Jam pipeline (`new Date()`) dikendalikan dengan mock.timers (hanya API Date) agar tanggal & menit
 * lokal deterministik dan bebas dari libur nasional nyata di DB uji. Semua data di tahun 2091.
 * Respons divalidasi terhadap kontrak (NODE_ENV=test).
 */
import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { POST as checkInRoute } from "@/app/api/v1/student/attendance/check-in/route";
import { POST as precheckRoute } from "@/app/api/v1/student/attendance/precheck/route";
import { GET as todayRoute } from "@/app/api/v1/student/attendance/today/route";
import { setStorageDriver } from "@/lib/storage/driver";
import { toDbDate } from "@/lib/time/zone";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin, createSuperAdmin, type TestStudent } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { callMultipart } from "../../students/helpers";
import { addStudent, checkInForm, createWorld, localInstant, precheckBodyAt, SCHOOL_POINT, solidSelfie, type World } from "./fixtures";

interface Today {
  date: string;
  serverTime: string;
  timezone: string;
  ianaTimezone: string;
  schoolDay: { isSchoolDay: boolean; reason: string; holidayName: string | null };
  window: { opensAt: string; lateAfter: string; closesAt: string; state: string };
  geofence: Record<string, number>;
  record: { id: string; status: string; source: string; checkInTimeLocal: string | null; lateMinutes: number | null } | null;
  pendingLeave: { id: string; type: string; startDate: string; endDate: string } | null;
  canCheckIn: boolean;
  blockReason: string | null;
}
interface CheckInResult {
  attendance: { id: string; status: string; lateMinutes: number | null; date: string; source: string; checkInTimeLocal: string };
  replayed: boolean;
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

const DAY = "2091-03-05";
const HOLIDAY = "2091-03-06";
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
  mock.timers.enable({ apis: ["Date"], now: localInstant(DAY, 430, "WIB").getTime() });
  storage = await createTempStorage();
  setStorageDriver(null);
  world = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  otherSchool = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  await prisma.holiday.create({ data: { schoolId: world.school.id, name: "Libur Uji Route", startDate: toDbDate(HOLIDAY), endDate: toDbDate(HOLIDAY) } });
});
after(async () => {
  mock.timers.reset();
  setStorageDriver(null);
  await storage.cleanup();
  await disconnect();
});

async function studentWithToken(target: World = world, options: Parameters<typeof addStudent>[1] = {}): Promise<TestStudent & { token: string }> {
  const st = await addStudent(target, options);
  return { ...st, token: (await createSessionToken(st.user.id)).token };
}

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; SM-A146P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const DESKTOP_CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const agent = (userAgent?: string) => (userAgent ? { "user-agent": userAgent } : undefined);
const getToday = (token: string, userAgent?: string) =>
  callRoute<Envelope<Today>>(todayRoute, { method: "GET", url: "/api/v1/student/attendance/today", bearer: token, headers: agent(userAgent) });
const postPrecheck = (token: string, json: unknown, userAgent?: string) =>
  callRoute<Envelope<Precheck>>(precheckRoute, { method: "POST", url: "/api/v1/student/attendance/precheck", bearer: token, json, headers: agent(userAgent) });
const postCheckIn = (token: string, form: FormData, userAgent?: string) =>
  callMultipart<Envelope<CheckInResult>>(checkInRoute, { url: "/api/v1/student/attendance/check-in", form, bearer: token, headers: agent(userAgent) });

test("today -> check-in HADIR (201) -> today tercatat -> replay 200", async () => {
  const now = setLocalTime(430);
  const st = await studentWithToken();
  const initial = await getToday(st.token);
  assert.equal(initial.status, 200, JSON.stringify(initial.body?.error));
  assert.deepEqual(initial.body?.data, {
    date: DAY,
    serverTime: now.toISOString(),
    timezone: "WIB",
    ianaTimezone: "Asia/Jakarta",
    schoolDay: { isSchoolDay: true, reason: "SCHOOL_DAY", holidayName: null },
    window: { opensAt: "06:00", lateAfter: "07:15", closesAt: "10:00", state: "OPEN" },
    geofence: { radiusM: 150, maxAccuracyM: 100, latitude: SCHOOL_POINT.latitude, longitude: SCHOOL_POINT.longitude },
    record: null,
    pendingLeave: null,
    canCheckIn: true,
    blockReason: null,
  });

  const created = await postCheckIn(st.token, checkInForm(now, await solidSelfie()));
  assert.equal(created.status, 201, JSON.stringify(created.body?.error));
  assert.equal(created.body?.data.attendance.status, "HADIR");
  assert.equal(created.body?.data.attendance.date, DAY);
  assert.equal(created.body?.data.attendance.checkInTimeLocal, "07:10");
  assert.equal(created.body?.data.replayed, false);
  assert.equal(JSON.stringify(created.body).includes("anomal"), false);

  const afterCheckIn = (await getToday(st.token)).body!.data;
  assert.deepEqual(afterCheckIn.record, { id: created.body?.data.attendance.id, status: "HADIR", source: "CHECKIN", checkInTimeLocal: "07:10", lateMinutes: null });
  assert.equal(afterCheckIn.canCheckIn, false);
  assert.equal(afterCheckIn.blockReason, "ALREADY_CHECKED_IN");

  const later = setLocalTime(700);
  const { token: laterToken } = await createSessionToken(st.user.id);
  const replay = await postCheckIn(laterToken, checkInForm(later, await solidSelfie()));
  assert.equal(replay.status, 200, JSON.stringify(replay.body?.error));
  assert.equal(replay.body?.data.replayed, true);
  assert.equal(replay.body?.data.attendance.id, created.body?.data.attendance.id);
});

test("check-in TERLAMBAT via route: lateMinutes dihitung dari bel masuk", async () => {
  const now = setLocalTime(460);
  const st = await studentWithToken();
  const res = await postCheckIn(st.token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 201, JSON.stringify(res.body?.error));
  assert.equal(res.body?.data.attendance.status, "TERLAMBAT");
  assert.equal(res.body?.data.attendance.lateMinutes, 40);
  assert.match(res.body?.data.message ?? "", /Terlambat 40 menit/);
});

test("izin PENDING yang mencakup hari ini tampil di today", async () => {
  setLocalTime(400);
  const st = await studentWithToken();
  const leave = await prisma.leaveRequest.create({
    data: { schoolId: world.school.id, studentId: st.student.id, type: "SAKIT", startDate: toDbDate("2091-03-04"), endDate: toDbDate("2091-03-06"), reason: "Demam tinggi sejak pagi" },
  });
  const today = (await getToday(st.token)).body!.data;
  assert.deepEqual(today.pendingLeave, { id: leave.id, type: "SAKIT", startDate: "2091-03-04", endDate: "2091-03-06" });
  assert.equal(today.canCheckIn, true, "izin PENDING tidak menghalangi check-in");
});

test("hari libur: today NOT_SCHOOL_DAY + nama libur; check-in 422 NOT_SCHOOL_DAY", async () => {
  const now = setLocalTime(430, HOLIDAY);
  const st = await studentWithToken();
  const today = (await getToday(st.token)).body!.data;
  assert.deepEqual(today.schoolDay, { isSchoolDay: false, reason: "HOLIDAY", holidayName: "Libur Uji Route" });
  assert.equal(today.blockReason, "NOT_SCHOOL_DAY");
  const res = await postCheckIn(st.token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "NOT_SCHOOL_DAY");
  assert.deepEqual(res.body?.error?.details, { reason: "HOLIDAY", holidayName: "Libur Uji Route" });
});

test("precheck via route: lolos / di luar geofence, tanpa menulis apa pun", async () => {
  const now = setLocalTime(445);
  const st = await studentWithToken();
  const ok = await postPrecheck(st.token, precheckBodyAt(now));
  assert.equal(ok.status, 200, JSON.stringify(ok.body?.error));
  assert.deepEqual({ ...ok.body?.data, message: "" }, { ok: true, reason: null, message: "", distanceM: 20, radiusM: 150, window: "OPEN", wouldBeLate: true });
  const outside = await postPrecheck(st.token, precheckBodyAt(now, { meters: 800 }));
  assert.equal(outside.body?.data.ok, false);
  assert.equal(outside.body?.data.reason, "OUTSIDE_GEOFENCE");
  assert.equal(outside.body?.data.distanceM, 800);
  assert.equal(await prisma.checkInRejection.count({ where: { studentId: st.student.id } }), 0);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
});

test("422 lokasi via route: detail & pesan dikirim, percobaan dicatat, tanpa baris absensi", async () => {
  const now = setLocalTime(430);
  const st = await studentWithToken();
  const res = await postCheckIn(st.token, checkInForm(now, await solidSelfie(), { meters: 412 }));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "OUTSIDE_GEOFENCE");
  assert.deepEqual(res.body?.error?.details, { distanceM: 412, radiusM: 150 });
  assert.equal(res.body?.error?.message, "Anda berada 412 m dari sekolah (batas 150 m).");
  const mocked = await postCheckIn(st.token, checkInForm(now, await solidSelfie(), { mocked: true }));
  assert.equal(mocked.body?.error?.code, "MOCK_LOCATION");
  assert.equal(await prisma.checkInRejection.count({ where: { studentId: st.student.id } }), 2);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
});

test("jendela: sebelum buka / sesudah tutup -> today blockReason + check-in 422", async () => {
  setLocalTime(359);
  const st = await studentWithToken();
  assert.equal((await getToday(st.token)).body?.data.blockReason, "CHECKIN_NOT_OPEN");
  const now = setLocalTime(600);
  const { token } = await createSessionToken(st.user.id);
  const today = (await getToday(token)).body!.data;
  assert.equal(today.window.state, "CLOSED");
  assert.equal(today.blockReason, "CHECKIN_CLOSED");
  const res = await postCheckIn(token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 422);
  assert.equal(res.body?.error?.code, "CHECKIN_CLOSED");
  assert.deepEqual(res.body?.error?.details, { closedAt: "10:00" });
});

test("409 bila sekolah sudah mencatat (ADMIN) hari ini", async () => {
  const now = setLocalTime(430);
  const st = await studentWithToken();
  await prisma.attendance.create({ data: { schoolId: world.school.id, studentId: st.student.id, date: toDbDate(DAY), status: "SAKIT", source: "ADMIN" } });
  assert.equal((await getToday(st.token)).body?.data.blockReason, "ATTENDANCE_ALREADY_RECORDED");
  const res = await postCheckIn(st.token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 409);
  assert.equal(res.body?.error?.code, "ATTENDANCE_ALREADY_RECORDED");
  assert.deepEqual(res.body?.error?.details, { status: "SAKIT", source: "ADMIN" });
});

test("400 validasi: field hilang / angka tidak valid / kunci asing (tanpa id siswa dari body); 415 bukan multipart", async () => {
  const now = setLocalTime(430);
  const st = await studentWithToken();
  const selfie = await solidSelfie();
  const noSelfie = checkInForm(now, selfie);
  noSelfie.delete("selfie");
  const cases: FormData[] = [noSelfie, checkInForm(now, selfie, { extra: { latitude: "abc" } }), checkInForm(now, selfie, { extra: { studentId: "siswa-lain" } })];
  for (const form of cases) {
    const res = await postCheckIn(st.token, form);
    assert.equal(res.status, 400);
    assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
  }
  const badPrecheck = await postPrecheck(st.token, { ...precheckBodyAt(now), latitude: "-6.9" });
  assert.equal(badPrecheck.status, 400);
  const asJson = await callRoute<Envelope>(checkInRoute, { method: "POST", url: "/api/v1/student/attendance/check-in", bearer: st.token, json: {} });
  assert.equal(asJson.status, 415);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
});

test("selfie bukan gambar -> 415 tanpa baris absensi & tanpa berkas", async () => {
  const now = setLocalTime(430);
  const st = await studentWithToken();
  const res = await postCheckIn(st.token, checkInForm(now, Buffer.from("<html>bukan foto</html>".repeat(50))));
  assert.equal(res.status, 415);
  assert.equal(res.body?.error?.code, "UNSUPPORTED_MEDIA_TYPE");
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
  assert.equal(await prisma.storedFile.count({ where: { uploadedById: st.user.id } }), 0);
});

test("403 gerbang peran: admin sekolah & super admin tidak boleh; 401 tanpa token", async () => {
  const now = setLocalTime(430);
  const admin = await createSchoolAdmin(world.school.id);
  const superAdmin = await createSuperAdmin();
  for (const user of [admin, superAdmin]) {
    const { token } = await createSessionToken(user.id, { platform: "WEB", deviceId: null });
    assert.equal((await getToday(token)).status, 403);
    assert.equal((await postPrecheck(token, precheckBodyAt(now))).body?.error?.code, "FORBIDDEN");
    assert.equal((await postCheckIn(token, checkInForm(now, await solidSelfie()))).status, 403);
  }
  const anonymous = await callRoute<Envelope>(todayRoute, { method: "GET", url: "/api/v1/student/attendance/today" });
  assert.equal(anonymous.status, 401);
});

test("sesi WEB / sesi tanpa deviceId -> 403 CHECKIN_MOBILE_ONLY (today, precheck, check-in) tanpa menulis apa pun", async () => {
  const now = setLocalTime(430);
  const st = await addStudent(world);
  const web = await createSessionToken(st.user.id, { platform: "WEB", deviceId: null });
  const noDevice = await createSessionToken(st.user.id, { platform: "ANDROID", deviceId: null });
  for (const { token } of [web, noDevice]) {
    const today = await getToday(token);
    assert.equal(today.status, 403);
    assert.equal(today.body?.error?.code, "CHECKIN_MOBILE_ONLY");
    assert.equal((await postPrecheck(token, precheckBodyAt(now, { mocked: true }))).body?.error?.code, "CHECKIN_MOBILE_ONLY");
    const res = await postCheckIn(token, checkInForm(now, await solidSelfie(), { deviceId: "totally-random-9999" }));
    assert.equal(res.status, 403);
    assert.equal(res.body?.error?.code, "CHECKIN_MOBILE_ONLY");
  }
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
  assert.equal(await prisma.checkInRejection.count({ where: { studentId: st.student.id } }), 0);
  assert.equal(await prisma.storedFile.count({ where: { uploadedById: st.user.id } }), 0);
  const mobile = await createSessionToken(st.user.id);
  assert.equal((await postCheckIn(mobile.token, checkInForm(now, await solidSelfie()))).status, 201, "sesi mobile ber-deviceId tetap boleh");
});

test("sesi WEB ber-deviceId: browser desktop 403 CHECKIN_MOBILE_ONLY; browser HP boleh absen + flag WEB_CHECKIN", async () => {
  const now = setLocalTime(430);
  const st = await addStudent(world);
  const web = await createSessionToken(st.user.id, { platform: "WEB", deviceId: "web-browser-0001" });
  const desktop = await getToday(web.token, DESKTOP_CHROME);
  assert.equal(desktop.body?.error?.code, "CHECKIN_MOBILE_ONLY");
  const phone = await getToday(web.token, ANDROID_CHROME);
  assert.equal(phone.status, 200, JSON.stringify(phone.body?.error));
  assert.equal((await postPrecheck(web.token, precheckBodyAt(now), ANDROID_CHROME)).body?.data?.ok, true);
  const form = checkInForm(now, await solidSelfie(), { deviceId: "web-browser-0001" });
  const created = await postCheckIn(web.token, form, ANDROID_CHROME);
  assert.equal(created.status, 201, JSON.stringify(created.body?.error));
  const row = await prisma.attendance.findFirstOrThrow({ where: { studentId: st.student.id }, select: { anomalyFlags: true } });
  assert.deepEqual(row.anomalyFlags, ["WEB_CHECKIN"]);
});

test("siswa wajib ganti password / siswa LULUS ditolak check-in (403)", async () => {
  const now = setLocalTime(430);
  const mustChange = await studentWithToken(world, { mustChangePassword: true });
  assert.equal((await getToday(mustChange.token)).body?.error?.code, "PASSWORD_CHANGE_REQUIRED");
  const graduated = await studentWithToken(world, { status: "GRADUATED" });
  const res = await postCheckIn(graduated.token, checkInForm(now, await solidSelfie()));
  assert.equal(res.status, 403);
  assert.equal(res.body?.error?.code, "STUDENT_NOT_ACTIVE");
});

test("IDOR: today hanya menampilkan catatan milik sendiri (siswa lain & sekolah lain tidak terlihat)", async () => {
  const now = setLocalTime(430);
  const a = await studentWithToken();
  const b = await studentWithToken();
  const foreign = await studentWithToken(otherSchool);
  assert.equal((await postCheckIn(b.token, checkInForm(now, await solidSelfie()))).status, 201);
  assert.equal((await postCheckIn(foreign.token, checkInForm(now, await solidSelfie()))).status, 201);
  const todayA = (await getToday(a.token)).body!.data;
  assert.equal(todayA.record, null);
  assert.equal(todayA.canCheckIn, true);
  const rowsA = await prisma.attendance.count({ where: { studentId: a.student.id } });
  assert.equal(rowsA, 0);
});

test("rate limit CHECK_IN per user (precheck + check-in berbagi kuota): percobaan ke-11 -> 429", async () => {
  const now = setLocalTime(430);
  const st = await studentWithToken();
  for (let i = 0; i < 10; i += 1) assert.equal((await postPrecheck(st.token, precheckBodyAt(now))).status, 200);
  const limited = await postCheckIn(st.token, checkInForm(now, await solidSelfie()));
  assert.equal(limited.status, 429);
  assert.equal(limited.body?.error?.code, "RATE_LIMITED");
  assert.ok(limited.headers.get("retry-after"));
});
