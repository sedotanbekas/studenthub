/**
 * Check-in lewat service dengan jam suntikan (ctx.now) agar tanggal & menit lokal deterministik.
 * Semua data di tahun 2091 (tanpa libur nasional) pada sekolah baru; berkas di storage sementara.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { checkIn } from "@/lib/attendance/check-in-service";
import { attendanceLockKey } from "@/lib/lock-keys";
import { precheckAttendance } from "@/lib/attendance/precheck-service";
import { getStorage, setStorageDriver } from "@/lib/storage/driver";
import { toDbDate } from "@/lib/time/zone";
import { holdLock, raceWhileHeld } from "../../academics/helpers";
import { disconnect, prisma } from "../../helpers/db";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import {
  actionContext,
  addStudent,
  checkInBodyAt,
  createWorld,
  DEVICE,
  localInstant,
  orphanSelfieKeys,
  precheckBodyAt,
  solidSelfie,
  storedKeysOnDisk,
  studentPrincipal,
  texturedSelfie,
  type World,
} from "./fixtures";

const DAY = "2091-03-05";
const HOLIDAY = "2091-03-07";
let storage: TempStorage;
let world: World;

before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  world = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
});
after(async () => {
  setStorageDriver(null);
  await storage.cleanup();
  await disconnect();
});

const at = (minute: number, date = DAY) => localInstant(date, minute, "WIB");
const selfieCount = (userId: string) => prisma.storedFile.count({ where: { uploadedById: userId, kind: "ATTENDANCE_SELFIE" } });
const rejectionsOf = (studentId: string) => prisma.checkInRejection.findMany({ where: { studentId, schoolId: world.school.id }, orderBy: { createdAt: "asc" } });

async function checkInAs(st: Awaited<ReturnType<typeof addStudent>>, now: Date, options: Parameters<typeof checkInBodyAt>[2] = {}, selfie?: Buffer) {
  return checkIn(checkInBodyAt(now, selfie ?? (await solidSelfie()), options), actionContext(studentPrincipal(st), now));
}

test("HADIR: baris + StoredFile + berkas di disk; respons tanpa flag anomali", async () => {
  const st = await addStudent(world);
  const now = at(430);
  const out = await checkInAs(st, now);
  assert.equal(out.status, 201);
  assert.deepEqual(out.result.attendance, {
    id: out.result.attendance.id,
    date: DAY,
    status: "HADIR",
    lateMinutes: null,
    checkInAt: now.toISOString(),
    checkInTimeLocal: "07:10",
    distanceM: 20,
    source: "CHECKIN",
  });
  assert.equal(out.result.replayed, false);
  assert.match(out.result.message, /Hadir pukul 07:10/);
  const row = await prisma.attendance.findFirst({ where: { id: out.result.attendance.id, schoolId: world.school.id }, include: { selfieFile: true } });
  assert.ok(row?.selfieFile);
  assert.equal(row.classId, world.classId);
  assert.equal(row.date.toISOString(), toDbDate(DAY).toISOString());
  assert.equal(row.deviceId, DEVICE);
  assert.equal(row.isMocked, false);
  assert.equal(row.accuracyM, 12);
  assert.equal(row.hasAnomaly, false);
  assert.deepEqual(row.anomalyFlags, []);
  assert.equal(row.selfieFile.kind, "ATTENDANCE_SELFIE");
  assert.equal(row.selfieFile.schoolId, world.school.id);
  assert.equal(row.selfieFile.uploadedById, st.user.id);
  assert.ok(await getStorage().exists(row.selfieFile.storageKey));
});

test("TERLAMBAT: menit lokal > mulai + toleransi, lateMinutes dari bel masuk", async () => {
  const st = await addStudent(world);
  const out = await checkInAs(st, at(460));
  assert.equal(out.result.attendance.status, "TERLAMBAT");
  assert.equal(out.result.attendance.lateMinutes, 40);
  assert.match(out.result.message, /Terlambat 40 menit \(pukul 07:40\)/);
  const boundary = await checkInAs(await addStudent(world), at(435));
  assert.equal(boundary.result.attendance.status, "HADIR", "tepat di mulai + toleransi masih HADIR");
});

test("replay: check-in kedua (setelah tutup & dari jauh) -> 200 catatan yang sama, selfie kedua tidak disimpan", async () => {
  const st = await addStudent(world);
  const first = await checkInAs(st, at(430));
  const second = await checkInAs(st, at(700), { meters: 9000 });
  assert.equal(second.status, 200);
  assert.equal(second.result.replayed, true);
  assert.equal(second.result.attendance.id, first.result.attendance.id);
  assert.match(second.result.message, /sudah tercatat/);
  assert.equal(await selfieCount(st.user.id), 1);
});

test("dua submit bersamaan -> satu baris, satu berkas, tanpa berkas yatim di disk", async () => {
  const st = await addStudent(world);
  const now = at(440);
  const [a, b] = await Promise.all([checkInAs(st, now, {}, await texturedSelfie()), checkInAs(st, now, {}, await texturedSelfie())]);
  assert.deepEqual([a.status, b.status].sort(), [200, 201]);
  assert.equal(a.result.attendance.id, b.result.attendance.id);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 1);
  assert.equal(await selfieCount(st.user.id), 1);
  assert.ok((await storedKeysOnDisk(storage.root)).length > 0);
  assert.deepEqual(await orphanSelfieKeys(storage.root), [], "berkas di disk tanpa baris StoredFile");
});

test("penolakan lokasi dicatat (koordinat 3 desimal, dibuang > 2 km) tanpa berkas; maks 20 per hari", async () => {
  const st = await addStudent(world);
  const now = at(430);
  await assert.rejects(checkInAs(st, now, { meters: 500 }), (e: { status: number; code: string; details: unknown }) => {
    assert.equal(e.status, 422);
    assert.equal(e.code, "OUTSIDE_GEOFENCE");
    assert.deepEqual(e.details, { distanceM: 500, radiusM: 150 });
    return true;
  });
  await assert.rejects(checkInAs(st, now, { meters: 3000 }), { code: "OUTSIDE_GEOFENCE" });
  await assert.rejects(checkInAs(st, now, { mocked: true }), { status: 422, code: "MOCK_LOCATION" });
  await assert.rejects(checkInAs(st, now, { accuracy: 150 }), { code: "GPS_ACCURACY_TOO_LOW" });
  await assert.rejects(checkInAs(st, now, { fixAgeMs: 181_000 }), { code: "LOCATION_STALE" });
  const rows = await rejectionsOf(st.student.id);
  assert.deepEqual(rows.map((r) => r.reason).sort(), ["GPS_ACCURACY_TOO_LOW", "LOCATION_STALE", "MOCK_LOCATION", "OUTSIDE_GEOFENCE", "OUTSIDE_GEOFENCE"]);
  const near = rows.find((r) => r.distanceM === 500);
  const far = rows.find((r) => r.distanceM === 3000);
  const mocked = rows.find((r) => r.reason === "MOCK_LOCATION");
  assert.equal(near?.latitude?.toString(), "-6.91");
  assert.equal(near?.longitude?.toString(), "107.61");
  assert.equal(near?.distanceM, 500);
  assert.equal(near?.deviceId, DEVICE);
  assert.equal(near?.date.toISOString(), toDbDate(DAY).toISOString());
  assert.equal(far?.latitude, null);
  assert.equal(far?.distanceM, 3000);
  assert.equal(mocked?.isMocked, true);
  assert.equal(await selfieCount(st.user.id), 0);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
  const filler = Array.from({ length: 15 }, () => ({ schoolId: world.school.id, studentId: st.student.id, date: toDbDate(DAY), reason: "OUTSIDE_GEOFENCE" as const }));
  await prisma.checkInRejection.createMany({ data: filler });
  await assert.rejects(checkInAs(st, now, { meters: 600 }), { code: "OUTSIDE_GEOFENCE" });
  assert.equal((await rejectionsOf(st.student.id)).length, 20);
});

test("penolakan kalender (belum buka / sudah tutup) tidak dicatat sebagai percobaan lokasi", async () => {
  const st = await addStudent(world);
  await assert.rejects(checkInAs(st, at(359)), (e: { code: string; details: unknown }) => {
    assert.equal(e.code, "CHECKIN_NOT_OPEN");
    assert.deepEqual(e.details, { opensAt: "06:00" });
    return true;
  });
  await assert.rejects(checkInAs(st, at(600), { meters: 5000 }), { status: 422, code: "CHECKIN_CLOSED" });
  assert.equal((await rejectionsOf(st.student.id)).length, 0);
});

test("NOT_SCHOOL_DAY pada libur sekolah (detail alasan + nama libur)", async () => {
  await prisma.holiday.create({ data: { schoolId: world.school.id, name: "Libur Uji Absensi", startDate: toDbDate(HOLIDAY), endDate: toDbDate(HOLIDAY) } });
  const st = await addStudent(world);
  await assert.rejects(checkInAs(st, at(430, HOLIDAY)), (e: { status: number; code: string; details: unknown; message: string }) => {
    assert.equal(e.status, 422);
    assert.equal(e.code, "NOT_SCHOOL_DAY");
    assert.deepEqual(e.details, { reason: "HOLIDAY", holidayName: "Libur Uji Absensi" });
    assert.match(e.message, /Libur Uji Absensi/);
    return true;
  });
  await assert.rejects(checkInAs(st, at(430, "2091-07-15")), { code: "NOT_SCHOOL_DAY" }, "di luar semester");
});

test("baris LEAVE dikonversi menjadi CHECKIN (leaveRequestId dipertahankan + catatan)", async () => {
  const st = await addStudent(world);
  const leave = await prisma.leaveRequest.create({
    data: { schoolId: world.school.id, studentId: st.student.id, type: "IZIN", startDate: toDbDate(DAY), endDate: toDbDate(DAY), reason: "Acara keluarga penting", status: "APPROVED" },
  });
  const leaveRow = await prisma.attendance.create({
    data: { schoolId: world.school.id, studentId: st.student.id, classId: world.classId, date: toDbDate(DAY), status: "IZIN", source: "LEAVE", leaveRequestId: leave.id },
  });
  const out = await checkInAs(st, at(470));
  assert.equal(out.status, 201);
  assert.equal(out.result.attendance.id, leaveRow.id);
  assert.equal(out.result.attendance.source, "CHECKIN");
  assert.equal(out.result.attendance.status, "TERLAMBAT");
  const row = await prisma.attendance.findFirst({ where: { id: leaveRow.id, schoolId: world.school.id } });
  assert.equal(row?.leaveRequestId, leave.id);
  assert.equal(row?.note, "Hadir pada hari izin");
  assert.ok(row?.selfieFileId);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 1);
});

test("baris ADMIN / AUTO_ALPHA -> 409 ATTENDANCE_ALREADY_RECORDED tanpa berkas", async () => {
  for (const [source, status] of [["ADMIN", "HADIR"], ["AUTO_ALPHA", "ALPHA"]] as const) {
    const st = await addStudent(world);
    await prisma.attendance.create({ data: { schoolId: world.school.id, studentId: st.student.id, date: toDbDate(DAY), status, source } });
    await assert.rejects(checkInAs(st, at(430)), (e: { status: number; code: string; details: unknown }) => {
      assert.equal(e.status, 409);
      assert.equal(e.code, "ATTENDANCE_ALREADY_RECORDED");
      assert.deepEqual(e.details, { status, source });
      return true;
    });
    assert.equal(await selfieCount(st.user.id), 0);
  }
});

test("selfie di-re-encode (maks 640 px) dan EXIF dibuang", async () => {
  const st = await addStudent(world);
  const withExif = await sharp({ create: { width: 1200, height: 1600, channels: 3, background: { r: 10, g: 200, b: 30 } } })
    .withExif({ IFD0: { ImageDescription: "rahasia-lokasi-rumah", Make: "KameraUji" } })
    .jpeg()
    .toBuffer();
  assert.ok((await sharp(withExif).metadata()).exif, "fixture harus ber-EXIF");
  const out = await checkInAs(st, at(431), {}, withExif);
  const row = await prisma.attendance.findFirst({ where: { id: out.result.attendance.id, schoolId: world.school.id }, include: { selfieFile: true } });
  assert.ok(row?.selfieFile);
  const stored = await getStorage().read(row.selfieFile.storageKey);
  const meta = await sharp(stored).metadata();
  assert.equal(meta.exif, undefined);
  assert.equal(meta.format, "jpeg");
  assert.ok(Math.max(meta.width, meta.height) <= 640);
  assert.equal(stored.includes(Buffer.from("rahasia-lokasi-rumah")), false);
});

test("sekolah WIT: 15:30Z = 00:30 WIT tanggal berikutnya", async () => {
  const wit = await createWorld({ timezone: "WIT", termStart: "2091-01-02", termEnd: "2091-06-28", schedule: { open: 0, start: 20, tolerance: 0, close: 120, dayEnd: 130 } });
  const st = await addStudent(wit);
  const now = new Date("2091-03-04T15:30:00.000Z");
  const out = await checkIn(checkInBodyAt(now, await solidSelfie()), actionContext(studentPrincipal(st), now));
  assert.equal(out.result.attendance.date, "2091-03-05");
  assert.equal(out.result.attendance.checkInTimeLocal, "00:30");
  assert.equal(out.result.attendance.status, "TERLAMBAT");
  assert.equal(out.result.attendance.lateMinutes, 10);
  const row = await prisma.attendance.findFirst({ where: { id: out.result.attendance.id, schoolId: wit.school.id } });
  assert.equal(row?.date.toISOString(), "2091-03-05T00:00:00.000Z");
});

test("precheck memakai keputusan yang sama; selain MOCK_LOCATION tidak menulis apa pun", async () => {
  const st = await addStudent(world);
  const now = at(445);
  const ctx = actionContext(studentPrincipal(st), now);
  const outside = await precheckAttendance(precheckBodyAt(now, { meters: 500 }), ctx);
  assert.deepEqual(
    { ...outside, message: undefined },
    { ok: false, reason: "OUTSIDE_GEOFENCE", message: undefined, distanceM: 500, radiusM: 150, window: "OPEN", wouldBeLate: true },
  );
  const inside = await precheckAttendance(precheckBodyAt(now, { mocked: null }), ctx);
  assert.equal(inside.ok, true);
  assert.equal(inside.reason, null);
  assert.equal(inside.distanceM, 20);
  const nullIsland = await precheckAttendance({ ...precheckBodyAt(now), latitude: 0, longitude: 0 }, ctx);
  assert.equal(nullIsland.reason, "INVALID_LOCATION");
  assert.equal(nullIsland.distanceM, null);
  const stale = await precheckAttendance(precheckBodyAt(now, { meters: 900, fixAgeMs: 600_000 }), ctx);
  assert.equal(stale.reason, "LOCATION_STALE");
  assert.equal(stale.distanceM, null, "jarak hanya dikirim bila keputusan mencapai langkah geofence");
  assert.equal((await rejectionsOf(st.student.id)).length, 0);
  assert.equal(await prisma.attendance.count({ where: { studentId: st.student.id } }), 0);
  assert.equal(await selfieCount(st.user.id), 0);
  await checkInAs(st, now);
  const replay = await precheckAttendance(precheckBodyAt(now, { meters: 700 }), ctx);
  assert.equal(replay.reason, "ALREADY_CHECKED_IN");
  assert.equal(replay.distanceM, null);
});

test("precheck MOCK_LOCATION dicatat untuk admin (isMocked, deviceId sesi), tanpa jarak; kuota 20/hari dipatuhi", async () => {
  const st = await addStudent(world);
  const now = at(430);
  const ctx = actionContext(studentPrincipal(st), now);
  const mocked = await precheckAttendance(precheckBodyAt(now, { mocked: true, meters: 4072 }), ctx);
  assert.equal(mocked.ok, false);
  assert.equal(mocked.reason, "MOCK_LOCATION");
  assert.equal(mocked.distanceM, null, "jarak tidak dibocorkan untuk lokasi palsu (cegah trilaterasi titik sekolah)");
  const [logged] = await rejectionsOf(st.student.id);
  assert.equal(logged?.reason, "MOCK_LOCATION");
  assert.equal(logged?.isMocked, true);
  assert.equal(logged?.deviceId, DEVICE);
  assert.equal(logged?.distanceM, 4072, "admin tetap melihat jarak");
  assert.equal(logged?.latitude, null, "jarak > 2 km: koordinat tidak disimpan (rejectionLocation)");
  for (let i = 0; i < 25; i += 1) await precheckAttendance(precheckBodyAt(now, { mocked: true }), ctx);
  assert.equal((await rejectionsOf(st.student.id)).length, 20);
  await assert.rejects(checkInAs(st, now, { mocked: true }), { status: 422, code: "MOCK_LOCATION" });
  assert.equal((await rejectionsOf(st.student.id)).length, 20, "kuota harian dibagi dengan check-in");
});

test("precheck di hari libur: NOT_SCHOOL_DAY tanpa jarak dan tanpa catatan", async () => {
  const st = await addStudent(world);
  const now = at(430, "2091-03-08");
  await prisma.holiday.create({ data: { schoolId: world.school.id, name: "Libur Uji Precheck", startDate: toDbDate("2091-03-08"), endDate: toDbDate("2091-03-08") } });
  const out = await precheckAttendance(precheckBodyAt(now, { mocked: true }), actionContext(studentPrincipal(st), now));
  assert.equal(out.reason, "NOT_SCHOOL_DAY");
  assert.equal(out.distanceM, null);
  assert.equal((await rejectionsOf(st.student.id)).length, 0);
});

test("SHARED_DEVICE: siswa kedua dengan deviceId sama -> kedua baris ditandai (hasAnomaly)", async () => {
  const sharedDevice = "device-shared-7777";
  const first = await addStudent(world);
  const second = await addStudent(world);
  const a = await checkIn(checkInBodyAt(at(430), await texturedSelfie(), { deviceId: sharedDevice }), actionContext(studentPrincipal(first, sharedDevice), at(430)));
  const b = await checkIn(checkInBodyAt(at(432), await texturedSelfie(), { deviceId: sharedDevice }), actionContext(studentPrincipal(second, sharedDevice), at(432)));
  const rows = await prisma.attendance.findMany({ where: { id: { in: [a.result.attendance.id, b.result.attendance.id] }, schoolId: world.school.id } });
  for (const row of rows) {
    assert.deepEqual(row.anomalyFlags, ["SHARED_DEVICE"], row.studentId);
    assert.equal(row.hasAnomaly, true);
  }
  assert.equal(JSON.stringify(b.result).includes("SHARED_DEVICE"), false, "flag tidak pernah dikirim ke siswa");
});

test("DEVICE_SESSION_MISMATCH, DUPLICATE_SELFIE, dan NEW_DEVICE", async () => {
  const st = await addStudent(world);
  const photo = await texturedSelfie();
  const day1 = at(430, "2091-03-12");
  const mismatch = await checkIn(checkInBodyAt(day1, photo, { deviceId: "device-lain-12345" }), actionContext(studentPrincipal(st), day1));
  const row1 = await prisma.attendance.findFirst({ where: { id: mismatch.result.attendance.id, schoolId: world.school.id } });
  assert.deepEqual(row1?.anomalyFlags, ["DEVICE_SESSION_MISMATCH"]);
  const day2 = at(430, "2091-03-13");
  await prisma.student.update({ where: { id: st.student.id }, data: { boundDeviceId: DEVICE, deviceBoundAt: new Date(day2.getTime() - 3_600_000) } });
  const dup = await checkIn(checkInBodyAt(day2, photo), actionContext(studentPrincipal(st), day2));
  const row2 = await prisma.attendance.findFirst({ where: { id: dup.result.attendance.id, schoolId: world.school.id } });
  assert.deepEqual(row2?.anomalyFlags, ["DUPLICATE_SELFIE", "NEW_DEVICE"]);
  assert.equal(row2?.hasAnomaly, true);
  const day3 = at(430, "2091-03-14");
  const fresh = await checkIn(checkInBodyAt(day3, await texturedSelfie()), actionContext(studentPrincipal(st), day3));
  const row3 = await prisma.attendance.findFirst({ where: { id: fresh.result.attendance.id, schoolId: world.school.id } });
  assert.deepEqual(row3?.anomalyFlags, ["NEW_DEVICE"], "masih dalam 7 hari sejak perangkat berganti");
});

test("siswa berstatus tidak aktif di DB ditolak 403 walau principal masih ACTIVE", async () => {
  const st = await addStudent(world, { status: "INACTIVE" });
  const principal = { ...studentPrincipal(st), studentStatus: "ACTIVE" as const };
  await assert.rejects(checkIn(checkInBodyAt(at(430), await solidSelfie()), actionContext(principal, at(430))), { status: 403, code: "STUDENT_NOT_ACTIVE" });
});

test("kunci attendance:<studentId>: baris ADMIN yang ter-commit selagi check-in menunggu -> 409 tanpa berkas", async () => {
  const st = await addStudent(world);
  const held = await holdLock(attendanceLockKey(st.student.id), (tx) =>
    tx.attendance.create({ data: { schoolId: world.school.id, studentId: st.student.id, date: toDbDate(DAY), status: "HADIR", source: "ADMIN" } }),
  );
  const [code] = await raceWhileHeld(held, [() => checkInAs(st, at(430)).then(() => "OK", (e: { code?: string }) => e.code ?? "ERROR")]);
  assert.equal(code, "ATTENDANCE_ALREADY_RECORDED");
  assert.equal(await selfieCount(st.user.id), 0);
  assert.deepEqual(await orphanSelfieKeys(storage.root), []);
});

test("kunci attendance:<studentId>: baris LEAVE yang muncul selagi menunggu -> dikonversi (bukan duplikat)", async () => {
  const st = await addStudent(world);
  const leave = await prisma.leaveRequest.create({
    data: { schoolId: world.school.id, studentId: st.student.id, type: "SAKIT", startDate: toDbDate(DAY), endDate: toDbDate(DAY), reason: "Sakit perut sejak malam", status: "APPROVED" },
  });
  const held = await holdLock(attendanceLockKey(st.student.id), (tx) =>
    tx.attendance.create({ data: { schoolId: world.school.id, studentId: st.student.id, date: toDbDate(DAY), status: "SAKIT", source: "LEAVE", leaveRequestId: leave.id } }),
  );
  const [out] = await raceWhileHeld(held, [() => checkInAs(st, at(430))]);
  assert.equal(out?.status, 201);
  const rows = await prisma.attendance.findMany({ where: { studentId: st.student.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.source, "CHECKIN");
  assert.equal(rows[0]?.leaveRequestId, leave.id);
  assert.equal(rows[0]?.note, "Hadir pada hari izin");
});

test("kunci attendance:<studentId>: siswa dinonaktifkan / pindah kelas selagi check-in menunggu -> dibaca ulang di bawah kunci", async () => {
  const inactive = await addStudent(world);
  const heldStatus = await holdLock(attendanceLockKey(inactive.student.id), (tx) =>
    tx.student.update({ where: { id: inactive.student.id }, data: { status: "INACTIVE" } }),
  );
  const [code] = await raceWhileHeld(heldStatus, [() => checkInAs(inactive, at(430)).then(() => "OK", (e: { code?: string }) => e.code ?? "ERROR")]);
  assert.equal(code, "STUDENT_NOT_ACTIVE");
  assert.equal(await prisma.attendance.count({ where: { studentId: inactive.student.id } }), 0);
  assert.equal(await selfieCount(inactive.user.id), 0);

  const moved = await addStudent(world);
  const heldClass = await holdLock(attendanceLockKey(moved.student.id), (tx) => tx.student.update({ where: { id: moved.student.id }, data: { currentClassId: null } }));
  const [out] = await raceWhileHeld(heldClass, [() => checkInAs(moved, at(430))]);
  assert.equal(out?.status, 201);
  const row = await prisma.attendance.findFirstOrThrow({ where: { studentId: moved.student.id } });
  assert.equal(row.classId, null, "snapshot kelas dari baris siswa terkunci, bukan konteks sebelum kunci");
});
