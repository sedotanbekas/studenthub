/**
 * Mode uji absensi (sementara): super admin membuka/mengunci lewat /api/v1/platform/attendance/test-mode (diaudit,
 * idempoten; admin sekolah 403). Selama terbuka, check-in jauh dari sekolah, di luar jam, dan di luar semester
 * diterima dengan flag TEST_MODE, sedangkan akurasi GPS rendah tetap ditolak; setelah dikunci kembali ditolak lagi.
 * Database test dipakai bersama berkas lain, jadi mode uji SELALU dikunci di before() dan after().
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DELETE as lockRoute, GET as statusRoute, POST as openRoute } from "@/app/api/v1/platform/attendance/test-mode/route";
import { checkIn } from "@/lib/attendance/check-in-service";
import { precheckAttendance } from "@/lib/attendance/precheck-service";
import { getTodayAttendance } from "@/lib/attendance/student-queries";
import { isAppError } from "@/lib/http/errors";
import { setStorageDriver } from "@/lib/storage/driver";
import { webToken } from "../../academics/helpers";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin, createSuperAdmin } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { actionContext, addStudent, checkInBodyAt, createWorld, localInstant, precheckBodyAt, studentPrincipal, texturedSelfie, type World } from "./fixtures";

interface TestMode { enabled: boolean; since: string | null }

const URL = "/api/v1/platform/attendance/test-mode";
const IN_TERM = "2091-03-05";
const OUTSIDE_TERM = "2091-07-10";
const FAR_M = 5000;
let storage: TempStorage;
let world: World;
let superToken: string;

const lockNow = () => prisma.platformSetting.update({ where: { id: 1 }, data: { attendanceTestModeSince: null } });
const open = (token = superToken) => callRoute<Envelope<TestMode>>(openRoute, { method: "POST", url: URL, bearer: token });
const lock = (token = superToken) => callRoute<Envelope<TestMode>>(lockRoute, { method: "DELETE", url: URL, bearer: token });
const status = () => callRoute<Envelope<TestMode>>(statusRoute, { method: "GET", url: URL, bearer: superToken });
const at = (minute: number, date = IN_TERM) => localInstant(date, minute, "WIB");
/** Data amplop respons (gagal bila body kosong). */
function dataOf<T>(result: { body: Envelope<T> | null }): T {
  assert.ok(result.body, "respons tanpa body");
  return result.body.data;
}
const auditCount = (action: string, since: Date) => prisma.auditLog.count({ where: { action, createdAt: { gte: since } } });

before(async () => {
  await lockNow();
  storage = await createTempStorage();
  setStorageDriver(null);
  world = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  superToken = await webToken((await createSuperAdmin()).id);
});
after(async () => {
  await lockNow();
  setStorageDriver(null);
  await storage.cleanup();
  await disconnect();
});

async function checkInAs(st: Awaited<ReturnType<typeof addStudent>>, now: Date, options: Parameters<typeof checkInBodyAt>[2] = {}) {
  return checkIn(checkInBodyAt(now, await texturedSelfie(), options), actionContext(studentPrincipal(st), now));
}

const rowOf = (studentId: string) =>
  prisma.attendance.findFirstOrThrow({ where: { studentId, schoolId: world.school.id }, select: { status: true, anomalyFlags: true, hasAnomaly: true, distanceM: true } });

async function rejectionCode(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (isAppError(error)) return error.code;
    throw error;
  }
}

test("hanya super admin membuka/mengunci; idempoten dan setiap perubahan diaudit", async () => {
  const startedAt = new Date(Date.now() - 1000);
  const schoolAdmin = await createSchoolAdmin(world.school.id);
  assert.equal((await open(await webToken(schoolAdmin.id))).status, 403);
  assert.deepEqual(dataOf(await status()), { enabled: false, since: null });

  const opened = await open();
  assert.equal(opened.status, 200);
  assert.equal(dataOf(opened).enabled, true);
  assert.ok(dataOf(opened).since);
  assert.deepEqual(dataOf(await open()), dataOf(opened), "membuka dua kali tidak mengubah waktu mulai");
  assert.equal(await auditCount("platform.attendance_test_mode.enable", startedAt), 1);

  assert.deepEqual(dataOf(await lock()), { enabled: false, since: null });
  assert.deepEqual(dataOf(await lock()), { enabled: false, since: null });
  assert.equal(await auditCount("platform.attendance_test_mode.disable", startedAt), 1);
});

test("terbuka: 5 km dari sekolah setelah jam tutup dan di luar semester diterima dengan flag TEST_MODE; akurasi rendah tetap ditolak", async () => {
  await open();
  const far = await addStudent(world);
  const out = await checkInAs(far, at(700), { meters: FAR_M });
  assert.equal(out.status, 201);
  const farRow = await rowOf(far.student.id);
  assert.equal(farRow.status, "TERLAMBAT");
  assert.deepEqual(farRow.anomalyFlags, ["TEST_MODE"]);
  assert.equal(farRow.hasAnomaly, true, "tampil di antrean anomali admin sekolah");
  assert.ok(Math.abs((farRow.distanceM ?? 0) - FAR_M) <= 1);

  const offTerm = await addStudent(world);
  const today = await getTodayAttendance(actionContext(studentPrincipal(offTerm), at(400, OUTSIDE_TERM)));
  assert.equal(today.schoolDay.isSchoolDay, false);
  assert.equal(today.canCheckIn, true);
  assert.equal(today.testMode, true);
  const precheck = await precheckAttendance(precheckBodyAt(at(400, OUTSIDE_TERM), { meters: FAR_M }), actionContext(studentPrincipal(offTerm), at(400, OUTSIDE_TERM)));
  assert.equal(precheck.ok, true);
  assert.match(precheck.message, /^Mode uji/);
  assert.equal((await checkInAs(offTerm, at(400, OUTSIDE_TERM), { meters: 20 })).status, 201);
  assert.deepEqual((await rowOf(offTerm.student.id)).anomalyFlags, ["TEST_MODE"]);

  const blurry = await addStudent(world);
  assert.equal(await rejectionCode(checkInAs(blurry, at(700), { meters: FAR_M, accuracy: 150 })), "GPS_ACCURACY_TOO_LOW");
});

test("dikunci kembali: jarak dan jam absen diperiksa lagi", async () => {
  await open();
  await lock();
  const st = await addStudent(world);
  assert.equal(await rejectionCode(checkInAs(st, at(400), { meters: FAR_M })), "OUTSIDE_GEOFENCE");
  assert.equal(await rejectionCode(checkInAs(st, at(700), { meters: 20 })), "CHECKIN_CLOSED");
  const today = await getTodayAttendance(actionContext(studentPrincipal(st), at(400, OUTSIDE_TERM)));
  assert.equal(today.testMode, false);
  assert.equal(today.canCheckIn, false);
});
