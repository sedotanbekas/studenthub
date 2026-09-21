/**
 * Endpoint siswa izin/sakit: ajukan (dengan/tanpa lampiran), aturan rentang & hari sekolah, tumpang tindih,
 * batal, daftar & detail milik sendiri, notifikasi LEAVE_SUBMITTED ke admin aktif, gerbang peran.
 */
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { POST as cancelRoute } from "@/app/api/v1/student/leave-requests/[id]/cancel/route";
import { GET as getOne } from "@/app/api/v1/student/leave-requests/[id]/route";
import { GET as listOwn, POST as createOwn } from "@/app/api/v1/student/leave-requests/route";
import { resetAllLimiters } from "@/lib/http/rate-limits";
import { getStorage, setStorageDriver } from "@/lib/storage/driver";
import { addDays, toDbDate } from "@/lib/time/zone";
import { disconnect, prisma } from "../../helpers/db";
import { createSchoolAdmin } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import {
  callMultipart,
  createLeaveSchool,
  createStudentWithToken,
  freeRun,
  leaveForm,
  photo,
  schoolDaysBetween,
  todayWib,
  useInlineDefer,
  type LeaveFormFields,
  type LeaveSchoolFixture,
  type StudentWithToken,
} from "./helpers";

interface Leave {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  schoolDayCount: number;
  reason: string;
  status: string;
  attachmentFileId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}
type LeaveBody = Envelope<Leave>;

const URL = "/api/v1/student/leave-requests";
let storage: TempStorage;
let restoreDefer: () => void = () => undefined;
let fx: LeaveSchoolFixture;
let inactiveAdminId = "";
let secondAdminId = "";

before(async () => {
  restoreDefer = useInlineDefer();
  storage = await createTempStorage();
  setStorageDriver(null);
  fx = await createLeaveSchool();
  secondAdminId = (await createSchoolAdmin(fx.school.id)).id;
  inactiveAdminId = (await createSchoolAdmin(fx.school.id, { isActive: false })).id;
});
beforeEach(() => resetAllLimiters());
after(async () => {
  setStorageDriver(null);
  await storage.cleanup();
  restoreDefer();
  await disconnect();
});

const submit = (student: StudentWithToken, fields: LeaveFormFields) =>
  callMultipart<LeaveBody>(createOwn, { url: URL, form: leaveForm(fields), bearer: student.token });
const cancel = (token: string, id: string) =>
  callRoute<LeaveBody>(cancelRoute, { method: "POST", url: `${URL}/${id}/cancel`, params: { id }, bearer: token });

describe("ajukan izin/sakit", () => {
  test("IZIN tanpa lampiran -> 201 PENDING + LEAVE_SUBMITTED ke setiap admin aktif", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(2, 3);
    const res = await submit(st, { ...range, reason: "  Menghadiri pernikahan kakak  " });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const leave = res.body?.data;
    assert.equal(leave?.status, "PENDING");
    assert.equal(leave?.type, "IZIN");
    assert.equal(leave?.reason, "Menghadiri pernikahan kakak");
    assert.equal(leave?.schoolDayCount, 3);
    assert.equal(leave?.attachmentFileId, null);
    const rows = await prisma.notification.findMany({ where: { type: "LEAVE_SUBMITTED", userId: { in: [fx.admin.id, secondAdminId, inactiveAdminId] } } });
    const notes = rows.filter((n) => (n.data as { id?: string } | null)?.id === leave?.id);
    const recipients = new Set(notes.map((n) => n.userId));
    assert.ok(recipients.has(fx.admin.id) && recipients.has(secondAdminId));
    assert.equal(recipients.has(inactiveAdminId), false);
    assert.equal(recipients.size, 2);
    assert.equal(notes[0]?.pushStatus, "SKIPPED");
  });

  test("SAKIT >= 3 hari sekolah tanpa lampiran -> 422 ATTACHMENT_REQUIRED; 2 hari boleh", async () => {
    const st = await createStudentWithToken(fx);
    const three = await freeRun(3, 3);
    const res = await submit(st, { ...three, type: "SAKIT", reason: "Demam tinggi dan flu berat" });
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "ATTACHMENT_REQUIRED");
    const ok = await submit(st, { startDate: three.startDate, endDate: addDays(three.startDate, 1), type: "SAKIT", reason: "Demam tinggi dan flu berat" });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
  });

  test("SAKIT dengan lampiran foto -> berkas privat LEAVE_ATTACHMENT tersimpan & terikat", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(8, 3);
    const res = await submit(st, { ...range, type: "SAKIT", reason: "Rawat inap karena tifus", attachment: await photo() });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const fileId = res.body?.data.attachmentFileId ?? "";
    const file = await prisma.storedFile.findFirst({ where: { id: fileId } });
    assert.equal(file?.kind, "LEAVE_ATTACHMENT");
    assert.equal(file?.schoolId, fx.school.id);
    assert.equal(file?.uploadedById, st.user.id);
    assert.equal(file?.mimeType, "image/jpeg");
    assert.ok(file?.attachedAt);
    assert.match(file?.storageKey ?? "", /^private\/leave-attachment\//);
    assert.equal(await getStorage().exists(file?.storageKey ?? ""), true);
  });

  test("lampiran bukan gambar -> 415, tanpa baris & tanpa berkas", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(12, 1);
    const before = await prisma.storedFile.count({ where: { uploadedById: st.user.id } });
    const res = await submit(st, { ...range, attachment: new Blob(["bukan gambar"], { type: "image/jpeg" }) });
    assert.equal(res.status, 415);
    assert.equal(await prisma.leaveRequest.count({ where: { studentId: st.student.id } }), 0);
    assert.equal(await prisma.storedFile.count({ where: { uploadedById: st.user.id } }), before);
  });

  test("izin beririsan -> 409 LEAVE_OVERLAP; bersebelahan boleh", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(14, 4);
    assert.equal((await submit(st, { startDate: range.startDate, endDate: addDays(range.startDate, 1) })).status, 201);
    const clash = await submit(st, { startDate: addDays(range.startDate, 1), endDate: range.endDate });
    assert.equal(clash.status, 409);
    assert.equal(clash.body?.error?.code, "LEAVE_OVERLAP");
    const adjacent = await submit(st, { startDate: addDays(range.startDate, 2), endDate: range.endDate });
    assert.equal(adjacent.status, 201, JSON.stringify(adjacent.body));
  });

  test("dua pengajuan bersamaan yang beririsan -> 201 dan 409", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(20, 2);
    const results = await Promise.all([submit(st, range), submit(st, range)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    assert.equal(await prisma.leaveRequest.count({ where: { studentId: st.student.id } }), 1);
  });

  test("aturan rentang: mundur > 7, maju > 30, > 14 hari, terbalik -> 422", async () => {
    const st = await createStudentWithToken(fx);
    const today = todayWib();
    const cases: Array<[LeaveFormFields, string]> = [
      [{ startDate: addDays(today, -8), endDate: addDays(today, -8) }, "LEAVE_BACKDATE_LIMIT"],
      [{ startDate: addDays(today, 31), endDate: addDays(today, 31) }, "LEAVE_ADVANCE_LIMIT"],
      [{ startDate: addDays(today, 1), endDate: addDays(today, 15) }, "LEAVE_TOO_LONG"],
      [{ startDate: addDays(today, 3), endDate: addDays(today, 2) }, "INVALID_DATE_RANGE"],
    ];
    for (const [fields, code] of cases) {
      const res = await submit(st, fields);
      assert.equal(res.status, 422, `${code}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body?.error?.code, code);
    }
  });

  test("rentang tanpa hari sekolah (libur sekolah) -> 422 NO_SCHOOL_DAYS_IN_RANGE", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(24, 2);
    await prisma.holiday.create({ data: { schoolId: fx.school.id, name: "Libur Uji Izin", startDate: toDbDate(range.startDate), endDate: toDbDate(range.endDate) } });
    const res = await submit(st, range);
    assert.equal(res.status, 422);
    assert.equal(res.body?.error?.code, "NO_SCHOOL_DAYS_IN_RANGE");
  });

  test("validasi 400: alasan < 10, tanggal tidak valid, field asing, jenis salah", async () => {
    const st = await createStudentWithToken(fx);
    const range = await freeRun(2, 1);
    const bad: LeaveFormFields[] = [
      { ...range, reason: "pendek" },
      { startDate: "2026-02-30", endDate: range.endDate },
      { ...range, extra: { studentId: st.student.id } },
      { ...range, extra: { type: "CUTI" } },
    ];
    for (const fields of bad) {
      const res = await submit(st, fields);
      assert.equal(res.status, 400, JSON.stringify(fields));
      assert.equal(res.body?.error?.code, "VALIDATION_FAILED");
    }
  });
});

describe("batal, daftar, detail", () => {
  test("batal milik sendiri -> CANCELLED; batal ulang 409; milik siswa lain 404; setelah batal rentang bebas lagi", async () => {
    const st = await createStudentWithToken(fx);
    const other = await createStudentWithToken(fx);
    const range = await freeRun(4, 2);
    const created = await submit(st, range);
    const id = created.body?.data.id ?? "";
    assert.equal((await cancel(other.token, id)).status, 404);
    const res = await cancel(st.token, id);
    assert.equal(res.status, 200);
    assert.equal(res.body?.data.status, "CANCELLED");
    const again = await cancel(st.token, id);
    assert.equal(again.status, 409);
    assert.equal(again.body?.error?.code, "LEAVE_NOT_PENDING");
    assert.equal((await submit(st, range)).status, 201);
  });

  test("daftar milik sendiri terbaru dulu + filter status + paginasi; detail milik lain 404", async () => {
    const st = await createStudentWithToken(fx);
    const other = await createStudentWithToken(fx);
    const a = await freeRun(5, 1);
    const b = await freeRun(9, 1);
    const first = (await submit(st, a)).body?.data.id ?? "";
    const second = (await submit(st, b)).body?.data.id ?? "";
    await submit(other, a);
    await cancel(st.token, first);
    const all = await callRoute<Envelope<Leave[]>>(listOwn, { method: "GET", url: `${URL}?limit=1`, bearer: st.token });
    assert.equal(all.status, 200);
    assert.deepEqual(all.body?.data.map((l) => l.id), [second]);
    assert.deepEqual(all.body?.meta, { total: 2, page: 1, limit: 1, totalPages: 2 });
    const cancelled = await callRoute<Envelope<Leave[]>>(listOwn, { method: "GET", url: `${URL}?status=CANCELLED`, bearer: st.token });
    assert.deepEqual(cancelled.body?.data.map((l) => l.id), [first]);
    const detail = await callRoute<LeaveBody>(getOne, { method: "GET", url: `${URL}/${second}`, params: { id: second }, bearer: st.token });
    assert.equal(detail.status, 200);
    assert.equal(detail.body?.data.schoolDayCount, (await schoolDaysBetween(b.startDate, b.endDate)).length);
    const foreign = await callRoute(getOne, { method: "GET", url: `${URL}/${second}`, params: { id: second }, bearer: other.token });
    assert.equal(foreign.status, 404);
    const badStatus = await callRoute(listOwn, { method: "GET", url: `${URL}?status=DONE`, bearer: st.token });
    assert.equal(badStatus.status, 400);
  });
});

describe("gerbang peran & status siswa", () => {
  test("admin sekolah memanggil endpoint siswa -> 403", async () => {
    const range = await freeRun(2, 1);
    const res = await callMultipart(createOwn, { url: URL, form: leaveForm(range), bearer: fx.adminToken });
    assert.equal(res.status, 403);
    assert.equal((await callRoute(listOwn, { method: "GET", url: URL, bearer: fx.adminToken })).status, 403);
  });

  test("siswa LULUS boleh membaca riwayat tetapi tidak boleh mengajukan (403 STUDENT_NOT_ACTIVE)", async () => {
    const grad = await createStudentWithToken(fx, { status: "GRADUATED" });
    const token = grad.token;
    assert.equal((await callRoute(listOwn, { method: "GET", url: URL, bearer: token })).status, 200);
    const res = await callMultipart(createOwn, { url: URL, form: leaveForm(await freeRun(2, 1)), bearer: token });
    assert.equal(res.status, 403);
    assert.equal((res.body as Envelope | null)?.error?.code, "STUDENT_NOT_ACTIVE");
  });

  test("tanpa token -> 401", async () => {
    assert.equal((await callRoute(listOwn, { method: "GET", url: URL })).status, 401);
  });
});
