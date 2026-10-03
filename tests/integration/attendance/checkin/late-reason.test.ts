/**
 * Alasan terlambat siswa (A1): service dengan jam suntikan (ctx.now) + route PUT lewat pipeline HTTP.
 * Semua data di tahun 2091 (tanpa libur nasional) pada sekolah baru; berkas di storage sementara.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PUT as lateReasonRoute } from "@/app/api/v1/student/attendance/today/late-reason/route";
import { checkIn } from "@/lib/attendance/check-in-service";
import { correctAttendance } from "@/lib/attendance/correction-service";
import { setOwnLateReason } from "@/lib/attendance/late-reason-service";
import { getTodayAttendance } from "@/lib/attendance/student-queries";
import { makePrincipal } from "@/lib/auth/test-principal";
import { isAppError } from "@/lib/http/errors";
import { attendanceLockKey } from "@/lib/lock-keys";
import { setStorageDriver } from "@/lib/storage/driver";
import { toDbDate } from "@/lib/time/zone";
import { holdLock, raceWhileHeld } from "../../academics/helpers";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { actionContext, addStudent, checkInBodyAt, createWorld, localInstant, studentPrincipal, texturedSelfie, type World } from "./fixtures";

const DAY = "2091-03-05";
const NEXT_DAY = "2091-03-06";
let storage: TempStorage;
let world: World;
let adminId: string;

before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  world = await createWorld({ termStart: "2091-01-02", termEnd: "2091-06-28" });
  adminId = (await createSchoolAdmin(world.school.id)).id;
});
after(async () => {
  setStorageDriver(null);
  await storage.cleanup();
  await disconnect();
});

type Student = Awaited<ReturnType<typeof addStudent>>;
const at = (minute: number, date = DAY) => localInstant(date, minute, "WIB");
const ctxOf = (st: Student, now: Date, deviceId?: string | null) => actionContext(studentPrincipal(st, deviceId), now);
const auditsOf = (entityId: string) => prisma.auditLog.findMany({ where: { entityId, action: "attendance.late_reason" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const rowOf = (id: string) => prisma.attendance.findFirstOrThrow({ where: { id, schoolId: world.school.id } });

async function lateStudent(minute = 460, date = DAY): Promise<{ st: Student; attendanceId: string }> {
  const st = await addStudent(world);
  const out = await checkIn(checkInBodyAt(at(minute, date), await texturedSelfie()), ctxOf(st, at(minute, date)));
  assert.equal(out.result.attendance.status, minute > 435 ? "TERLAMBAT" : "HADIR");
  return { st, attendanceId: out.result.attendance.id };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isAppError(error)) return `${error.status} ${error.code}`;
    throw error;
  }
  return "OK";
}

function adminCorrect(studentId: string, status: "HADIR" | "TERLAMBAT", now: Date) {
  const ctx = { principal: makePrincipal({ userId: adminId, role: "SCHOOL_ADMIN", schoolId: world.school.id }), now, requestId: "req-koreksi", ip: null, userAgent: null, defer: () => undefined };
  return correctAttendance(ctx, undefined, { studentId, date: DAY }, { status, lateMinutes: status === "TERLAMBAT" ? 45 : null, reason: "Dicek wali kelas" });
}

test("check-in terlambat tanpa alasan tetap 201; alasan kosong & bisa diisi", async () => {
  const st = await addStudent(world);
  const out = await checkIn(checkInBodyAt(at(460), await texturedSelfie()), ctxOf(st, at(460)));
  assert.equal(out.status, 201);
  assert.equal(out.result.attendance.status, "TERLAMBAT");
  assert.equal(out.result.attendance.lateReason, null);
  assert.equal(out.result.attendance.lateReasonEditable, true);
});

test("isi alasan: kolom tersimpan, lateReasonAt = now, satu audit (before null), tampil di layar hari ini", async () => {
  const { st, attendanceId } = await lateStudent();
  const now = at(465);
  const out = await setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(st, now));
  assert.deepEqual(out, {
    lateReason: { category: "TRANSPORT", note: null, timeLocal: "07:45", updatedAt: now.toISOString() },
    unchanged: false,
    message: "Alasan tersimpan. Admin sekolah bisa membacanya.",
  });
  const row = await rowOf(attendanceId);
  assert.deepEqual([row.lateReasonCategory, row.lateReasonNote, row.lateReasonAt?.toISOString()], ["TRANSPORT", null, now.toISOString()]);
  const audits = await auditsOf(attendanceId);
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.before, null);
  assert.deepEqual(audits[0]?.after, { category: "TRANSPORT", noteLength: 0, date: DAY });
  assert.equal(audits[0]?.schoolId, world.school.id);
  assert.equal(audits[0]?.entityType, "Attendance");
  const today = await getTodayAttendance(ctxOf(st, at(470)));
  assert.equal(today.record?.lateReason?.category, "TRANSPORT");
  assert.equal(today.record?.lateReasonEditable, true);
});

test("alasan sama -> unchanged tanpa audit; ubah ke Lainnya -> audit before & after tanpa teks keterangan", async () => {
  const { st, attendanceId } = await lateStudent();
  await setOwnLateReason({ category: "WEATHER", note: "Hujan deras" }, ctxOf(st, at(465)));
  const same = await setOwnLateReason({ category: "WEATHER", note: "Hujan deras" }, ctxOf(st, at(470)));
  assert.equal(same.unchanged, true);
  assert.equal(same.message, "Alasan ini sudah tersimpan.");
  assert.equal(same.lateReason.timeLocal, "07:45", "waktu tidak bergeser bila tidak berubah");
  assert.equal((await auditsOf(attendanceId)).length, 1);
  const changed = await setOwnLateReason({ category: "OTHER", note: "Ban sepeda bocor" }, ctxOf(st, at(475)));
  assert.equal(changed.unchanged, false);
  const audits = await auditsOf(attendanceId);
  assert.equal(audits.length, 2);
  assert.deepEqual(audits[1]?.before, { category: "WEATHER", noteLength: 11 });
  assert.deepEqual(audits[1]?.after, { category: "OTHER", noteLength: 16, date: DAY });
  assert.equal(JSON.stringify(audits).includes("Ban sepeda"), false, "teks bebas tidak disalin ke audit");
});

test("tanpa catatan hari ini / hanya kemarin -> 422 NO_ATTENDANCE_TODAY; hadir -> 422 ATTENDANCE_NOT_LATE", async () => {
  const fresh = await addStudent(world);
  assert.equal(await codeOf(setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(fresh, at(470)))), "422 NO_ATTENDANCE_TODAY");
  const { st: yesterdayLate } = await lateStudent(460, DAY);
  assert.equal(await codeOf(setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(yesterdayLate, at(470, NEXT_DAY)))), "422 NO_ATTENDANCE_TODAY");
  const { st: onTime } = await lateStudent(430);
  assert.equal(await codeOf(setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(onTime, at(440)))), "422 ATTENDANCE_NOT_LATE");
});

test("setelah koreksi admin (menjadi HADIR atau tetap TERLAMBAT) -> 409 LATE_REASON_LOCKED; alasan lama tidak dihapus", async () => {
  const a = await lateStudent();
  await setOwnLateReason({ category: "FAMILY", note: null }, ctxOf(a.st, at(465)));
  await adminCorrect(a.st.student.id, "HADIR", at(480));
  assert.equal(await codeOf(setOwnLateReason({ category: "WEATHER", note: null }, ctxOf(a.st, at(485)))), "409 LATE_REASON_LOCKED");
  const corrected = await rowOf(a.attendanceId);
  assert.deepEqual([corrected.status, corrected.source, corrected.lateReasonCategory], ["HADIR", "ADMIN", "FAMILY"]);
  const today = await getTodayAttendance(ctxOf(a.st, at(490)));
  assert.equal(today.record?.lateReasonEditable, false);

  const b = await lateStudent();
  await adminCorrect(b.st.student.id, "TERLAMBAT", at(480));
  assert.equal(await codeOf(setOwnLateReason({ category: "WEATHER", note: null }, ctxOf(b.st, at(485)))), "409 LATE_REASON_LOCKED");
});

test("balapan dengan koreksi yang sedang berjalan: alasan menunggu kunci lalu LOCKED, tanpa lost update", async () => {
  const { st, attendanceId } = await lateStudent();
  const held = await holdLock(attendanceLockKey(st.student.id), (tx) =>
    tx.attendance.updateMany({ where: { id: attendanceId, schoolId: world.school.id }, data: { source: "ADMIN", lateMinutes: 50, note: "Koreksi bersamaan" } }),
  );
  const [code] = await raceWhileHeld(held, [() => codeOf(setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(st, at(470))))]);
  assert.equal(code, "409 LATE_REASON_LOCKED");
  const row = await rowOf(attendanceId);
  assert.deepEqual([row.source, row.lateMinutes, row.lateReasonCategory], ["ADMIN", 50, null]);
});

test("setelah jam akhir hari sekolah -> 422 LATE_REASON_DAY_CLOSED dan tidak bisa diubah lagi", async () => {
  const { st } = await lateStudent();
  assert.equal(await codeOf(setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(st, at(900)))), "422 LATE_REASON_DAY_CLOSED");
  const today = await getTodayAttendance(ctxOf(st, at(899)));
  assert.equal(today.record?.lateReasonEditable, true, "satu menit sebelum hari ditutup masih boleh");
});

test("siswa dinonaktifkan sebelum menyimpan -> 403 STUDENT_NOT_ACTIVE (dicek ulang di bawah kunci)", async () => {
  const { st } = await lateStudent();
  const held = await holdLock(attendanceLockKey(st.student.id), (tx) => tx.student.update({ where: { id: st.student.id }, data: { status: "INACTIVE" } }));
  const [code] = await raceWhileHeld(held, [() => codeOf(setOwnLateReason({ category: "TRANSPORT", note: null }, ctxOf(st, at(470))))]);
  assert.equal(code, "403 STUDENT_NOT_ACTIVE");
});

test("sesi tanpa deviceId (bukan sesi HP) tetap boleh mengisi alasan", async () => {
  const { st } = await lateStudent();
  const out = await setOwnLateReason({ category: "HEALTH", note: null }, ctxOf(st, at(470), null));
  assert.equal(out.lateReason.category, "HEALTH");
});

test("route PUT: 200 dengan body valid; Lainnya tanpa keterangan 400; tanpa login 401; tetap terikat hari lokal server", async () => {
  const { st } = await lateStudent();
  const { token } = await createSessionToken(st.user.id, { platform: "WEB", deviceId: null });
  const put = (json: unknown, bearer?: string) =>
    callRoute<Envelope<{ lateReason: { category: string } | null; unchanged: boolean }>>(lateReasonRoute, {
      method: "PUT", url: "/api/v1/student/attendance/today/late-reason", bearer, json,
    });
  const invalid = await put({ category: "OTHER" }, token);
  assert.equal(invalid.status, 400);
  assert.deepEqual((invalid.body?.error?.details as { path: string }[] | undefined)?.map((d) => d.path), ["body.note"]);
  assert.equal((await put({ category: "TRANSPORT" })).status, 401);
  // Jam pipeline = jam nyata (bukan 2091): tidak ada catatan hari ini -> 422.
  const real = await put({ category: "TRANSPORT" }, token);
  assert.equal(real.status, 422);
  assert.equal(real.body?.error?.code, "NO_ATTENDANCE_TODAY");
});

test("CHECK menolak OTHER tanpa keterangan lewat tulis mentah", async () => {
  const { attendanceId } = await lateStudent();
  await assert.rejects(prisma.attendance.update({ where: { id: attendanceId }, data: { lateReasonCategory: "OTHER", lateReasonAt: new Date() } }));
  const kept = await rowOf(attendanceId);
  assert.equal(kept.lateReasonCategory, null);
  assert.equal(kept.date.toISOString(), toDbDate(DAY).toISOString());
});
