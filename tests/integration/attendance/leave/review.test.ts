/**
 * Endpoint admin izin/sakit: approve (materialisasi: konversi AUTO_ALPHA, pertahankan CHECKIN/ADMIN, buat
 * hari mendatang), approve ganda bersamaan, approve berpacu dengan auto-ALPHA, reject beralasan, input atas
 * nama siswa, daftar/filter/detail, notifikasi & audit.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { GET as fileRoute } from "@/app/api/v1/files/[id]/route";
import { POST as approveRoute } from "@/app/api/v1/school/leave-requests/[id]/approve/route";
import { POST as rejectRoute } from "@/app/api/v1/school/leave-requests/[id]/reject/route";
import { GET as detailRoute } from "@/app/api/v1/school/leave-requests/[id]/route";
import { GET as listRoute, POST as onBehalfRoute } from "@/app/api/v1/school/leave-requests/route";
import { POST as createOwn } from "@/app/api/v1/student/leave-requests/route";
import { isAttendanceDuplicate } from "@/lib/attendance/materialize";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { setStorageDriver } from "@/lib/storage/driver";
import { addDays, fromDbDate, instantAtLocal, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import {
  callMultipart,
  createLeaveSchool,
  createStudentWithToken,
  freeRun,
  leaveForm,
  leaveUrl,
  photo,
  schoolDaysBetween,
  seedAttendance,
  todayWib,
  useInlineDefer,
  type LeaveFormFields,
  type LeaveSchoolFixture,
  type StudentWithToken,
} from "./helpers";

interface SchoolLeave {
  id: string;
  status: string;
  type: string;
  startDate: string;
  endDate: string;
  schoolDayCount: number;
  reviewNote: string | null;
  reviewedAt: string | null;
  attachmentFileId: string | null;
  student: { id: string; name: string; nis: string; className: string | null };
}
interface Decision {
  leaveRequest: SchoolLeave;
  materialized: { created: string[]; converted: string[]; skipped: Array<{ date: string; reason: string }> };
}

let storage: TempStorage;
let restoreDefer: () => void = () => undefined;
let fx: LeaveSchoolFixture;

before(async () => {
  restoreDefer = useInlineDefer();
  storage = await createTempStorage();
  setStorageDriver(null);
  fx = await createLeaveSchool();
});
beforeEach(() => resetAllLimiters());
after(async () => {
  setStorageDriver(null);
  await storage.cleanup();
  restoreDefer();
  await disconnect();
});

async function submit(student: StudentWithToken, fields: LeaveFormFields): Promise<string> {
  const res = await callMultipart<Envelope<{ id: string }>>(createOwn, { url: "/api/v1/student/leave-requests", form: leaveForm(fields), bearer: student.token });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body?.data.id ?? "";
}
const approve = (id: string, json: unknown = {}, token = fx.adminToken) =>
  callRoute<Envelope<Decision>>(approveRoute, { method: "POST", url: leaveUrl(`/${id}/approve`), params: { id }, json, bearer: token });
const reject = (id: string, json: unknown, token = fx.adminToken) =>
  callRoute<Envelope<SchoolLeave>>(rejectRoute, { method: "POST", url: leaveUrl(`/${id}/reject`), params: { id }, json, bearer: token });
const onBehalf = (fields: LeaveFormFields, token = fx.adminToken) =>
  callMultipart<Envelope<Decision>>(onBehalfRoute, { url: leaveUrl(""), form: leaveForm(fields), bearer: token });

async function rowsOf(studentId: string) {
  const rows = await prisma.attendance.findMany({ where: { studentId }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ id: r.id, date: fromDbDate(r.date), status: r.status, source: r.source, leaveRequestId: r.leaveRequestId, classId: r.classId }));
}

describe("setujui", () => {
  test("mengonversi AUTO_ALPHA, mempertahankan CHECKIN & ADMIN, membuat hari lampau & mendatang", async () => {
    const st = await createStudentWithToken(fx);
    const today = todayWib();
    const [startDate, endDate] = [addDays(today, -7), addDays(today, 5)];
    const schoolDays = await schoolDaysBetween(startDate, endDate);
    const past = schoolDays.filter((d) => d < today);
    assert.ok(past.length >= 3, "butuh >= 3 hari sekolah lampau");
    const [alphaDate = "", checkinDate = "", adminDate = ""] = past;
    const alphaId = await seedAttendance(fx, st, { date: alphaDate, source: "AUTO_ALPHA" });
    await seedAttendance(fx, st, { date: checkinDate, source: "CHECKIN" });
    await seedAttendance(fx, st, { date: adminDate, source: "ADMIN", status: "HADIR" });
    const id = await submit(st, { startDate, endDate, type: "IZIN" });

    const res = await approve(id, { note: "  Semoga lancar  " });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { leaveRequest, materialized } = res.body?.data as Decision;
    assert.equal(leaveRequest.status, "APPROVED");
    assert.equal(leaveRequest.reviewNote, "Semoga lancar");
    assert.equal(leaveRequest.student.className, fx.klass.name);
    const expectedCreated = schoolDays.filter((d) => ![alphaDate, checkinDate, adminDate].includes(d));
    assert.deepEqual(materialized.created, expectedCreated);
    assert.ok(materialized.created.some((d) => d > today), "hari mendatang ikut dibuat");
    assert.deepEqual(materialized.converted, [alphaDate]);
    assert.deepEqual(materialized.skipped, [
      { date: checkinDate, reason: "CHECKED_IN" },
      { date: adminDate, reason: "ADMIN_OVERRIDE" },
    ].sort((a, b) => a.date.localeCompare(b.date)));

    const rows = await rowsOf(st.student.id);
    const byDate = new Map(rows.map((r) => [r.date, r]));
    assert.deepEqual(byDate.get(alphaDate), { id: alphaId, date: alphaDate, status: "IZIN", source: "LEAVE", leaveRequestId: id, classId: fx.klass.id });
    assert.equal(byDate.get(checkinDate)?.source, "CHECKIN");
    assert.equal(byDate.get(checkinDate)?.status, "HADIR");
    assert.equal(byDate.get(adminDate)?.source, "ADMIN");
    for (const date of expectedCreated) {
      assert.deepEqual({ ...byDate.get(date), id: "" }, { id: "", date, status: "IZIN", source: "LEAVE", leaveRequestId: id, classId: fx.klass.id });
    }
    assert.equal(rows.length, schoolDays.length);

    const note = await prisma.notification.findFirst({ where: { userId: st.user.id, type: "LEAVE_APPROVED" } });
    assert.match(note?.body ?? "", /telah disetujui\. Catatan: Semoga lancar/);
    assert.equal(note?.pushStatus, "PENDING");
    const audit = await prisma.auditLog.findFirst({ where: { action: "leave.approve", entityId: id } });
    assert.equal(audit?.actorId, fx.admin.id);
    assert.equal(audit?.schoolId, fx.school.id);
    assert.deepEqual((audit?.after as { materialized: { converted: string[] } }).materialized.converted, [alphaDate]);

    const again = await approve(id);
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "LEAVE_ALREADY_REVIEWED");
  });

  test("dua persetujuan bersamaan -> satu 200, satu 409; baris tidak ganda", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(2, 3);
    const id = await submit(st, range);
    const results = await Promise.all([approve(id), approve(id)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await rowsOf(st.student.id)).length, 3);
    assert.equal(await prisma.notification.count({ where: { userId: st.user.id, type: "LEAVE_APPROVED" } }), 1);
  });

  test("P2002 asli adapter pada (studentId, date) dikenali isAttendanceDuplicate (jalur ulang materialisasi)", async () => {
    const st = await createStudentWithToken(fx);
    const { startDate } = await freeRun(1, 1);
    await seedAttendance(fx, st, { date: startDate, source: "AUTO_ALPHA" });
    const error = await seedAttendance(fx, st, { date: startDate, source: "AUTO_ALPHA" }).then(() => null, (err: unknown) => err);
    assert.equal(isAttendanceDuplicate(error), true);
  });

  // Insert auto-ALPHA yang belum commit memegang kunci S (cek FK) atas baris Student, sehingga approve
  // menunggu di `Student FOR UPDATE` lalu membaca baris itu dan mengonversinya (tanpa baris ganda).
  test("berpacu dengan auto-ALPHA yang menyisipkan baris bersamaan -> dikonversi menjadi IZIN", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(5, 2);
    const id = await submit(st, range);
    let release: () => void = () => undefined;
    let markReady: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const ready = new Promise<void>((resolve) => (markReady = resolve));
    const holder = prisma.$transaction(async (tx) => {
      await tx.attendance.create({
        data: { schoolId: fx.school.id, studentId: st.student.id, classId: fx.klass.id, date: toDbDate(range.startDate), status: "ALPHA", source: "AUTO_ALPHA" },
      });
      markReady();
      await gate;
    }, { timeout: 20_000 });
    await ready;
    const pending = approve(id);
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await holder;
    const res = await pending;
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body?.data.materialized.converted, [range.startDate]);
    assert.deepEqual(res.body?.data.materialized.created, [range.endDate]);
    const rows = await rowsOf(st.student.id);
    assert.deepEqual(rows.map((r) => [r.date, r.status, r.source]), [[range.startDate, "IZIN", "LEAVE"], [range.endDate, "IZIN", "LEAVE"]]);
  });

  test("siswa tidak aktif -> 409 LEAVE_STUDENT_INACTIVE, izin tetap PENDING", async () => {
    const st = await createStudentWithToken(fx);
    const id = await submit(st, await freeRun(3, 1));
    await prisma.student.update({ where: { id: st.student.id }, data: { status: "INACTIVE" } });
    const res = await approve(id);
    assert.equal(res.status, 409);
    assert.equal(res.body?.error?.code, "LEAVE_STUDENT_INACTIVE");
    assert.equal((await prisma.leaveRequest.findFirst({ where: { id } }))?.status, "PENDING");
  });

  test("body tidak valid -> 400 (catatan > 255, field asing)", async () => {
    const st = await createStudentWithToken(fx);
    const id = await submit(st, await freeRun(4, 1));
    assert.equal((await approve(id, { note: "x".repeat(256) })).status, 400);
    assert.equal((await approve(id, { status: "APPROVED" })).status, 400);
  });
});

describe("tolak", () => {
  test("alasan wajib 5..255 -> 400; tolak -> REJECTED + LEAVE_REJECTED; absensi tidak disentuh; tolak ulang 409", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(6, 2);
    await seedAttendance(fx, st, { date: range.startDate, source: "ADMIN", status: "HADIR" });
    const id = await submit(st, range);
    assert.equal((await reject(id, {})).status, 400);
    assert.equal((await reject(id, { note: "ok" })).status, 400);
    const res = await reject(id, { note: "Surat tidak sah" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body?.data.status, "REJECTED");
    assert.equal(res.body?.data.reviewNote, "Surat tidak sah");
    const rows = await rowsOf(st.student.id);
    assert.deepEqual(rows.map((r) => r.source), ["ADMIN"]);
    const note = await prisma.notification.findFirst({ where: { userId: st.user.id, type: "LEAVE_REJECTED" } });
    assert.match(note?.body ?? "", /ditolak\. Alasan: Surat tidak sah/);
    assert.ok(await prisma.auditLog.findFirst({ where: { action: "leave.reject", entityId: id } }));
    const again = await reject(id, { note: "Tolak lagi saja" });
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "LEAVE_ALREADY_REVIEWED");
    assert.equal((await approve(id)).status, 409);
  });
});

describe("catat atas nama siswa", () => {
  test("mundur 30 hari boleh (siswa tidak), langsung APPROVED + dimaterialisasi + notifikasi + audit", async () => {
    const st = await createStudentWithToken(fx);
    const today = todayWib();
    const [startDate, endDate] = [addDays(today, -30), addDays(today, -28)];
    const res = await onBehalf({ studentId: st.student.id, startDate, endDate, type: "SAKIT", reason: "Dirawat di rumah sakit", attachment: await photo(), note: "Surat diterima" });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const decision = res.body?.data as Decision;
    assert.equal(decision.leaveRequest.status, "APPROVED");
    assert.equal(decision.leaveRequest.type, "SAKIT");
    assert.equal(decision.leaveRequest.reviewNote, "Surat diterima");
    assert.ok(decision.leaveRequest.attachmentFileId);
    const expected = await schoolDaysBetween(startDate, endDate);
    assert.deepEqual(decision.materialized.created, expected);
    const rows = await rowsOf(st.student.id);
    assert.deepEqual(rows.map((r) => r.status), expected.map(() => "SAKIT"));
    const row = await prisma.leaveRequest.findFirst({ where: { id: decision.leaveRequest.id } });
    assert.equal(row?.reviewedById, fx.admin.id);
    const file = await prisma.storedFile.findFirst({ where: { id: decision.leaveRequest.attachmentFileId ?? "" } });
    assert.equal(file?.uploadedById, fx.admin.id);
    const fileId = decision.leaveRequest.attachmentFileId ?? "";
    const download = (token: string) => callRoute(fileRoute, { method: "GET", url: `/api/v1/files/${fileId}`, params: { id: fileId }, bearer: token });
    assert.equal((await download(st.token)).status, 200, "siswa pemilik izin boleh membuka lampiran yang diunggah admin");
    assert.equal((await download((await createStudentWithToken(fx)).token)).status, 404, "siswa lain tidak boleh");
    const note = await prisma.notification.findFirst({ where: { userId: st.user.id, type: "LEAVE_APPROVED" } });
    assert.match(note?.title ?? "", /Sakit dicatat sekolah/);
    const audit = await prisma.auditLog.findFirst({ where: { action: "leave.create_on_behalf", entityId: decision.leaveRequest.id } });
    assert.equal(audit?.before, null);
  });

  for (const [label, minute, firstOffset] of [["sebelum jam tutup check-in (07:00)", 420, -4], ["setelah jam tutup check-in (13:00)", 780, -3]] as const) {
    test(`hari sebelum siswa wajib absen tidak dimaterialisasi (NOT_ENROLLED): aktivasi ${label}`, async () => {
      const today = todayWib();
      const activatedAt = instantAtLocal(addDays(today, -4), minute, "WIB");
      const st = await createStudentWithToken(fx, { activatedAt });
      const enrolledFrom = addDays(today, firstOffset);
      const [startDate, endDate] = [addDays(today, -10), addDays(today, -1)];
      const res = await onBehalf({ studentId: st.student.id, startDate, endDate });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const days = await schoolDaysBetween(startDate, endDate);
      const { created, skipped } = res.body?.data.materialized ?? { created: [], skipped: [] };
      assert.deepEqual(created, days.filter((d) => d >= enrolledFrom));
      assert.deepEqual(skipped, days.filter((d) => d < enrolledFrom).map((date) => ({ date, reason: "NOT_ENROLLED" })));
      assert.ok(skipped.length > 0);
    });
  }

  test("mundur 31 hari -> 422; beririsan -> 409; siswa tidak aktif -> 409; siswa tak dikenal -> 404", async () => {
    const st = await createStudentWithToken(fx);
    const today = todayWib();
    const tooOld = await onBehalf({ studentId: st.student.id, startDate: addDays(today, -31), endDate: addDays(today, -31) });
    assert.equal(tooOld.body?.error?.code, "LEAVE_BACKDATE_LIMIT");
    const range = await freeRun(7, 1);
    await submit(st, range);
    const clash = await onBehalf({ studentId: st.student.id, ...range });
    assert.equal(clash.status, 409);
    assert.equal(clash.body?.error?.code, "LEAVE_OVERLAP");
    const inactive = await createStudentWithToken(fx, { status: "INACTIVE" });
    const res = await onBehalf({ studentId: inactive.student.id, ...range });
    assert.equal(res.status, 409);
    assert.equal(res.body?.error?.code, "LEAVE_STUDENT_INACTIVE");
    assert.equal((await onBehalf({ studentId: "siswa-tidak-ada", ...range })).status, 404);
  });
});

describe("daftar & detail", () => {
  test("default PENDING terlama dulu; ALL; q nama/NIS (wildcard aman); kelas; from/to; detail + hari sekolah", async () => {
    const st = await createStudentWithToken(fx, { name: "Zulkarnain Leave", nis: `NISLV${Date.now() % 100000}` });
    const r1 = await freeRun(10, 1);
    const r2 = await freeRun(13, 2);
    const first = await submit(st, r1);
    const second = await submit(st, r2);
    const list = (query: string) =>
      callRoute<Envelope<SchoolLeave[]>>(listRoute, { method: "GET", url: `/api/v1/school/leave-requests?${query}`, bearer: fx.adminToken });
    const pending = await list(`q=${encodeURIComponent("Zulkarnain")}`);
    assert.equal(pending.status, 200);
    assert.deepEqual(pending.body?.data.map((l) => l.id), [first, second]);
    assert.equal(pending.body?.data[0]?.student.name, "Zulkarnain Leave");
    await reject(first, { note: "Tidak disetujui" });
    assert.deepEqual((await list("q=Zulkarnain")).body?.data.map((l) => l.id), [second]);
    assert.deepEqual((await list("q=Zulkarnain&status=ALL")).body?.data.map((l) => l.id), [second, first]);
    assert.deepEqual((await list(`q=${st.student.nis.slice(0, 6)}&status=REJECTED`)).body?.data.map((l) => l.id), [first]);
    assert.equal((await list("q=%25&status=ALL")).body?.data.length, 0);
    assert.deepEqual((await list(`q=Zulkarnain&status=ALL&from=${r2.startDate}&to=${r2.endDate}`)).body?.data.map((l) => l.id), [second]);
    assert.equal((await list(`q=Zulkarnain&classId=kelas-lain`)).body?.data.length, 0);
    assert.equal((await list(`q=Zulkarnain&classId=${fx.klass.id}`)).body?.data.length, 1);
    assert.equal((await list(`from=${r2.endDate}&to=${r2.startDate}`)).status, 400);
    assert.equal((await list("status=DONE")).status, 400);

    const detail = await callRoute<Envelope<SchoolLeave & { schoolDays: string[]; reviewedBy: { id: string } | null }>>(detailRoute, {
      method: "GET", url: leaveUrl(`/${first}`), params: { id: first }, bearer: fx.adminToken,
    });
    assert.equal(detail.status, 200);
    assert.deepEqual(detail.body?.data.schoolDays, await schoolDaysBetween(r1.startDate, r1.endDate));
    assert.equal(detail.body?.data.reviewedBy?.id, fx.admin.id);
  });

  test("siswa tidak boleh meninjau (403)", async () => {
    const st = await createStudentWithToken(fx);
    const id = await submit(st, await freeRun(15, 1));
    assert.equal((await approve(id, {}, st.token)).status, 403);
    assert.equal((await reject(id, { note: "Saya tolak sendiri" }, st.token)).status, 403);
    assert.equal((await callRoute(listRoute, { method: "GET", url: leaveUrl(""), bearer: st.token })).status, 403);
    assert.equal((await onBehalf({ studentId: st.student.id, ...(await freeRun(17, 1)) }, st.token)).status, 403);
  });
});
