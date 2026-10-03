/**
 * Tinjau anomali (B1): POST /school/attendance/{id}/anomaly-review — Valid / Tidak valid (jalur koreksi ALPHA),
 * audit & notifikasi, transisi, flag berubah, jendela 45 hari, hari non-sekolah, tenancy, balapan; lalu sisi baca
 * monitoring (antrean default belum ditinjau 46 hari, filter tinjauan, needsReview di Data Absensi/Peta, detail).
 * Tanggal relatif hari ini WIB (aturan tanggal koreksi memakai jam nyata).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { School, SchoolClass } from "@prisma/client";
import { POST } from "@/app/api/v1/school/attendance/[id]/anomaly-review/route";
import { GET as detailRoute } from "@/app/api/v1/school/attendance/[id]/route";
import { GET as anomaliesRoute } from "@/app/api/v1/school/attendance/anomalies/route";
import { GET as dailyRoute } from "@/app/api/v1/school/attendance/daily/route";
import { GET as mapRoute } from "@/app/api/v1/school/attendance/map/route";
import { addDays, toDbDate } from "@/lib/time/zone";
import { holdTx, raceWhileHeld, webToken, withSchool } from "../../academics/helpers";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createClass, createSchoolAdmin, createStudent, createSuperAdmin, type TestStudent, type TestUser } from "../../helpers/factories";
import { callRoute, type Envelope } from "../../helpers/request";
import { checkInRow, createAttendanceSchool, pastSchoolDate, useInlineDefer, wibToday } from "../jobs/fixtures";

interface ReviewDto {
  decision: string;
  note: string | null;
  reviewedAt: string;
  reviewer: { id: string; name: string } | null;
}

interface Reviewed {
  attendance: { id: string; status: string; source: string; lateMinutes: number | null; note: string | null; hasAnomaly: boolean; needsReview: boolean; review: ReviewDto | null };
  unchanged: boolean;
  statusChanged: boolean;
}

const today = wibToday();
const FLAGS = ["SHARED_DEVICE"];
const REASON = "Foto bukan wajah siswa";
let schoolA: School;
let schoolB: School;
let classA: SchoolClass;
let adminA: TestUser;
let tokenA = "";
let tokenB = "";
let superAdmin: TestUser;
let superToken = "";
let restoreDefer: () => void = () => undefined;

before(async () => {
  restoreDefer = useInlineDefer();
  const setup = { createdAt: new Date(Date.now() - 150 * 86_400_000), termStart: addDays(today, -100), termEnd: addDays(today, 30) };
  schoolA = await createAttendanceSchool(setup);
  schoolB = await createAttendanceSchool(setup);
  const term = await prisma.term.findFirstOrThrow({ where: { schoolId: schoolA.id } });
  classA = await createClass(schoolA.id, term.academicYearId);
  adminA = await createSchoolAdmin(schoolA.id);
  tokenA = await webToken(adminA.id);
  tokenB = await webToken((await createSchoolAdmin(schoolB.id)).id);
  superAdmin = await createSuperAdmin();
  superToken = await webToken(superAdmin.id);
});
after(async () => {
  restoreDefer();
  await disconnect();
});

const studentA = (): Promise<TestStudent> => createStudent(schoolA.id, { classId: classA.id });

interface FlaggedOptions {
  readonly status?: "HADIR" | "TERLAMBAT";
  readonly lateMinutes?: number;
  readonly flags?: string[];
  readonly hasAnomaly?: boolean;
  readonly schoolId?: string;
}

function flaggedRow(st: TestStudent, date: string, options: FlaggedOptions = {}) {
  return checkInRow({
    schoolId: options.schoolId ?? schoolA.id,
    studentId: st.student.id,
    userId: st.user.id,
    date,
    deviceId: uniq("dev"),
    status: options.status ?? "HADIR",
    lateMinutes: options.lateMinutes ?? null,
    anomalyFlags: options.flags ?? FLAGS,
    hasAnomaly: options.hasAnomaly ?? true,
  });
}

function review(id: string, body: unknown, token: string | null = tokenA, schoolId?: string) {
  return callRoute<Envelope<Reviewed>>(POST, {
    method: "POST",
    url: withSchool(`/api/v1/school/attendance/${id}/anomaly-review`, schoolId),
    ...(token ? { bearer: token } : {}),
    json: body,
    params: { id },
  });
}

const auditsFor = (entityId: string) =>
  prisma.auditLog.findMany({ where: { entityId, action: { in: ["attendance.anomaly_review", "attendance.correct"] } }, orderBy: { createdAt: "asc" } });
const notificationsFor = (userId: string) => prisma.notification.findMany({ where: { userId, type: "ATTENDANCE_CORRECTED" } });
const storedRow = (id: string, schoolId = schoolA.id) => prisma.attendance.findFirstOrThrow({ where: { id, schoolId } });

test("Valid tanpa catatan: absensi tetap, keluar dari antrean, satu audit tanpa notifikasi; keputusan sama = unchanged", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([1, 2, 3, 4]);
  const row = await flaggedRow(st, date, { status: "TERLAMBAT", lateMinutes: 20, flags: ["SHARED_DEVICE", "STALE_FIX"] });
  const res = await review(row.id, { decision: "VALID", flags: ["STALE_FIX", "SHARED_DEVICE"] });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const { attendance, unchanged, statusChanged } = res.body!.data;
  assert.deepEqual([unchanged, statusChanged, attendance.status, attendance.source, attendance.lateMinutes, attendance.needsReview], [false, false, "TERLAMBAT", "CHECKIN", 20, false]);
  assert.deepEqual({ ...attendance.review, reviewedAt: undefined }, { decision: "VALID", note: null, reviewer: { id: adminA.id, name: adminA.name }, reviewedAt: undefined });
  const audits = await auditsFor(row.id);
  assert.deepEqual(audits.map((a) => a.action), ["attendance.anomaly_review"]);
  assert.deepEqual(audits[0]?.before, { decision: null, note: null, status: "TERLAMBAT", source: "CHECKIN", lateMinutes: 20 });
  const afterAudit = audits[0]?.after as { decision: string; flags: string[]; date: string; studentId: string };
  assert.deepEqual([afterAudit.decision, [...afterAudit.flags].sort(), afterAudit.date, afterAudit.studentId], ["VALID", ["SHARED_DEVICE", "STALE_FIX"], date, st.student.id]);
  assert.equal((await notificationsFor(st.user.id)).length, 0);

  const again = await review(row.id, { decision: "VALID", note: "Sudah dicek wali kelas", flags: [] });
  assert.deepEqual([again.status, again.body?.data.unchanged], [200, true]);
  assert.equal(again.body?.data.attendance.review?.note, null, "keputusan sama tidak menimpa catatan");
  assert.equal((await auditsFor(row.id)).length, 1);
});

test("Tidak valid: TERLAMBAT -> ALPHA lewat jalur koreksi (sumber ADMIN, bukti & flag tetap), satu audit, siswa dinotifikasi", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([2, 3, 4, 5]);
  const row = await flaggedRow(st, date, { status: "TERLAMBAT", lateMinutes: 16 });
  const res = await review(row.id, { decision: "INVALID", note: `  ${REASON} `, flags: FLAGS });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual([res.body?.data.unchanged, res.body?.data.statusChanged, res.body?.data.attendance.status], [false, true, "ALPHA"]);
  const stored = await storedRow(row.id);
  assert.deepEqual(
    [stored.status, stored.source, stored.lateMinutes, stored.note, stored.anomalyReviewDecision, stored.anomalyReviewNote, stored.anomalyReviewedById],
    ["ALPHA", "ADMIN", null, REASON, "INVALID", REASON, adminA.id],
  );
  assert.deepEqual(
    [stored.selfieFileId, stored.deviceId, stored.checkInAt?.toISOString(), stored.anomalyFlags, stored.hasAnomaly],
    [row.selfieFileId, row.deviceId, row.checkInAt?.toISOString(), FLAGS, true],
  );
  const audits = await auditsFor(row.id);
  assert.deepEqual(audits.map((a) => a.action), ["attendance.anomaly_review"], "tanpa audit attendance.correct terpisah");
  assert.deepEqual(audits[0]?.after, { decision: "INVALID", note: REASON, status: "ALPHA", source: "ADMIN", lateMinutes: null, flags: FLAGS, date, studentId: st.student.id });
  const notes = await notificationsFor(st.user.id);
  assert.equal(notes.length, 1);
  assert.deepEqual(notes[0]?.data, { screen: "attendance", id: row.id });
  assert.match(notes[0]?.body ?? "", new RegExp(`Alpha .*Alasan: ${REASON}`));

  const same = await review(row.id, { decision: "INVALID", note: "Alasan lain yang berbeda", flags: FLAGS });
  assert.deepEqual([same.status, same.body?.data.unchanged, same.body?.data.statusChanged], [200, true, false]);
  const back = await review(row.id, { decision: "VALID", flags: FLAGS });
  assert.deepEqual([back.status, back.body?.error?.code], [409, "ANOMALY_ALREADY_INVALID"]);
  assert.equal((await auditsFor(row.id)).length, 1);
  assert.equal((await notificationsFor(st.user.id)).length, 1);
});

test("Valid lalu Tidak valid diizinkan; catatan yang sudah ALPHA -> statusChanged=false tanpa notifikasi", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([3, 4, 5, 6]);
  const row = await flaggedRow(st, date);
  assert.equal((await review(row.id, { decision: "VALID", note: "Perangkat milik kakak", flags: FLAGS })).status, 200);
  const invalid = await review(row.id, { decision: "INVALID", note: "Ternyata dititipkan teman", flags: FLAGS });
  assert.equal(invalid.status, 200, JSON.stringify(invalid.body?.error));
  assert.deepEqual([invalid.body?.data.statusChanged, invalid.body?.data.attendance.review?.decision, invalid.body?.data.attendance.review?.note], [true, "INVALID", "Ternyata dititipkan teman"]);
  assert.deepEqual((await auditsFor(row.id)).map((a) => (a.before as { decision: string | null }).decision), [null, "VALID"]);

  const other = await studentA();
  const alpha = await prisma.attendance.create({
    data: { schoolId: schoolA.id, studentId: other.student.id, date: toDbDate(date), status: "ALPHA", source: "ADMIN", note: "Koreksi uji", hasAnomaly: true, anomalyFlags: ["CLOCK_SKEW"] },
  });
  const res = await review(alpha.id, { decision: "INVALID", note: REASON, flags: ["CLOCK_SKEW"] });
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  assert.deepEqual([res.body?.data.unchanged, res.body?.data.statusChanged, res.body?.data.attendance.note], [false, false, "Koreksi uji"]);
  assert.equal((await storedRow(alpha.id)).anomalyReviewDecision, "INVALID");
  assert.equal((await notificationsFor(other.user.id)).length, 0);
});

test("tanpa anomali (flag LOW saja) -> 422 NO_ANOMALY; validasi bentuk -> 400 tanpa menulis", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([4, 5, 6, 7]);
  const low = await flaggedRow(st, date, { flags: ["STALE_FIX"], hasAnomaly: false });
  for (const decision of ["VALID", "INVALID"]) {
    const res = await review(low.id, { decision, note: REASON, flags: ["STALE_FIX"] });
    assert.deepEqual([res.status, res.body?.error?.code], [422, "NO_ANOMALY"], decision);
  }
  const other = await studentA();
  const row = await flaggedRow(other, date);
  const missingNote = await review(row.id, { decision: "INVALID", flags: FLAGS });
  assert.deepEqual([missingNote.status, missingNote.body?.error?.code], [400, "VALIDATION_FAILED"]);
  assert.deepEqual((missingNote.body?.error?.details as { path: string }[] | undefined)?.map((d) => d.path), ["body.note"]);
  const bodies = [
    { decision: "INVALID", note: "abcd", flags: FLAGS },
    { decision: "INVALID", note: "x".repeat(256), flags: FLAGS },
    { decision: "VALID", note: "ok", flags: FLAGS },
    { decision: "MAYBE", flags: FLAGS },
    { decision: "VALID" },
    { decision: "VALID", flags: ["MOCK_LOCATION"] },
    { decision: "VALID", flags: FLAGS, status: "HADIR" },
  ];
  for (const body of bodies) {
    const res = await review(row.id, body);
    assert.deepEqual([res.status, res.body?.error?.code], [400, "VALIDATION_FAILED"], JSON.stringify(body));
  }
  assert.equal((await storedRow(row.id)).anomalyReviewDecision, null);
  assert.equal((await auditsFor(row.id)).length, 0);
});

test("flag berbeda dari yang dilihat -> 409 ANOMALY_FLAGS_CHANGED; flag baru masuk selagi menunggu kunci baris -> 409", async () => {
  const st = await studentA();
  const date = await pastSchoolDate([5, 6, 7, 8]);
  const row = await flaggedRow(st, date, { flags: ["NEW_DEVICE", "SHARED_DEVICE"] });
  for (const flags of [["NEW_DEVICE"], ["NEW_DEVICE", "SHARED_DEVICE", "CLOCK_SKEW"]]) {
    const res = await review(row.id, { decision: "VALID", flags });
    assert.deepEqual([res.status, res.body?.error?.code], [409, "ANOMALY_FLAGS_CHANGED"], JSON.stringify(flags));
  }
  assert.equal((await storedRow(row.id)).anomalyReviewDecision, null);

  const other = await studentA();
  const swept = await flaggedRow(other, date, { flags: ["NEW_DEVICE"] });
  const held = await holdTx((tx) => tx.attendance.updateMany({ where: { id: swept.id, schoolId: schoolA.id }, data: { anomalyFlags: ["NEW_DEVICE", "SHARED_DEVICE"] } }));
  const [res] = await raceWhileHeld(held, [() => review(swept.id, { decision: "VALID", flags: ["NEW_DEVICE"] })]);
  assert.deepEqual([res?.status, res?.body?.error?.code], [409, "ANOMALY_FLAGS_CHANGED"]);
  assert.equal((await storedRow(swept.id)).anomalyReviewDecision, null);
  assert.equal((await auditsFor(swept.id)).length, 0);
});

test("jendela 45 hari: admin sekolah tidak bisa Tidak valid (Valid tetap bisa); super admin bisa", async () => {
  const st = await studentA();
  const old = await pastSchoolDate([50, 51, 52, 53]);
  const row = await flaggedRow(st, old);
  const expired = await review(row.id, { decision: "INVALID", note: REASON, flags: FLAGS });
  assert.deepEqual([expired.status, expired.body?.error?.code], [422, "CORRECTION_WINDOW_EXPIRED"]);
  assert.equal((await storedRow(row.id)).anomalyReviewDecision, null, "gagal = tidak ada yang tersimpan");
  assert.equal((await review(row.id, { decision: "VALID", flags: FLAGS })).status, 200);
  const bySuper = await review(row.id, { decision: "INVALID", note: REASON, flags: FLAGS }, superToken, schoolA.id);
  assert.equal(bySuper.status, 200, JSON.stringify(bySuper.body?.error));
  assert.deepEqual([bySuper.body?.data.statusChanged, bySuper.body?.data.attendance.review?.reviewer?.id], [true, superAdmin.id]);
});

test("bukan hari sekolah -> 422 NOT_SCHOOL_DAY (libur sekolah, di luar semester); Valid tetap bisa", async () => {
  const st = await studentA();
  const holidayDate = await pastSchoolDate([12, 13, 14, 15]);
  const row = await flaggedRow(st, holidayDate);
  await prisma.holiday.create({ data: { schoolId: schoolA.id, name: uniq("Libur"), startDate: toDbDate(holidayDate), endDate: toDbDate(holidayDate) } });
  const holiday = await review(row.id, { decision: "INVALID", note: REASON, flags: FLAGS });
  assert.deepEqual([holiday.status, holiday.body?.error?.code], [422, "NOT_SCHOOL_DAY"]);
  assert.equal((await review(row.id, { decision: "VALID", flags: FLAGS })).status, 200);

  const outside = await flaggedRow(await studentA(), addDays(today, -110));
  const res = await review(outside.id, { decision: "INVALID", note: REASON, flags: FLAGS }, superToken, schoolA.id);
  assert.deepEqual([res.status, res.body?.error?.code], [422, "NOT_SCHOOL_DAY"]);
});

test("akses: tanpa token 401, siswa 403, sekolah lain 404, schoolId lain 403, super admin tanpa schoolId 400", async () => {
  const st = await studentA();
  const row = await flaggedRow(st, await pastSchoolDate([1, 2, 3, 4]));
  const body = { decision: "VALID", flags: FLAGS };
  assert.equal((await review(row.id, body, null)).status, 401);
  assert.equal((await review(row.id, body, (await createSessionToken(st.user.id)).token)).status, 403);
  assert.equal((await review(row.id, body, tokenB)).status, 404);
  const mismatch = await review(row.id, body, tokenA, schoolB.id);
  assert.deepEqual([mismatch.status, mismatch.body?.error?.code], [403, "SCOPE_MISMATCH"]);
  const noScope = await review(row.id, body, superToken);
  assert.deepEqual([noScope.status, noScope.body?.error?.code], [400, "SCHOOL_ID_REQUIRED"]);
  assert.equal((await review(row.id, body, superToken, schoolB.id)).status, 404);
  assert.equal((await review("tidak-ada", body)).status, 404);
  assert.equal((await storedRow(row.id)).anomalyReviewDecision, null);
});

test("tinjauan paralel pada catatan yang sama diserialkan: satu menulis, satu unchanged; satu audit & satu notifikasi", async () => {
  const st = await studentA();
  const row = await flaggedRow(st, await pastSchoolDate([6, 7, 8, 9]));
  const body = { decision: "INVALID", note: REASON, flags: FLAGS };
  const results = await Promise.all([review(row.id, body), review(row.id, body)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200], JSON.stringify(results.map((r) => r.body?.error)));
  assert.deepEqual(results.map((r) => r.body?.data.unchanged).sort(), [false, true]);
  assert.equal((await auditsFor(row.id)).length, 1);
  assert.equal((await notificationsFor(st.user.id)).length, 1);
});

// ----------------------------------------------------------------------------- sisi baca monitoring

interface AnomalyRow {
  date: string;
  student: { name: string };
  reviewDecision: string | null;
}

test("sisi baca: antrean default belum ditinjau 46 hari, filter tinjauan, needsReview di Data Absensi/Peta, tinjauan di detail", async () => {
  const school = await createAttendanceSchool({ createdAt: new Date(Date.now() - 150 * 86_400_000), termStart: addDays(today, -100), termEnd: addDays(today, 30) });
  const admin = await createSchoolAdmin(school.id);
  const token = await webToken(admin.id);
  const activatedAt = new Date(Date.now() - 120 * 86_400_000);
  const named = async (name: string) => createStudent(school.id, { name, activatedAt });
  const [ani, budi, citra, dedi, eka, fajar] = [await named("Ani R"), await named("Budi R"), await named("Citra R"), await named("Dedi R"), await named("Eka R"), await named("Fajar R")];
  const yesterday = addDays(today, -1);
  const invalidDate = await pastSchoolDate([10, 11, 12, 13]);
  const at = (st: TestStudent, date: string, options: FlaggedOptions = {}) => flaggedRow(st, date, { schoolId: school.id, ...options });
  const aniRow = await at(ani, yesterday);
  const budiRow = await at(budi, yesterday);
  await at(citra, addDays(today, -45));
  await at(dedi, addDays(today, -46));
  const ekaRow = await at(eka, invalidDate);
  await at(fajar, yesterday, { flags: ["STALE_FIX"], hasAnomaly: false });
  assert.equal((await review(budiRow.id, { decision: "VALID", note: "Perangkat milik kakak", flags: FLAGS }, token)).status, 200);
  assert.equal((await review(ekaRow.id, { decision: "INVALID", note: REASON, flags: FLAGS }, token)).status, 200);

  const list = async (qs: string) => {
    const res = await callRoute<Envelope<AnomalyRow[]>>(anomaliesRoute, { method: "GET", url: `/api/v1/school/attendance/anomalies${qs}`, bearer: token });
    assert.equal(res.status, 200, `${qs} ${JSON.stringify(res.body?.error)}`);
    return res.body!.data.map((r) => [r.student.name, r.reviewDecision]);
  };
  assert.deepEqual(await list(""), [["Ani R", null], ["Citra R", null]], "default: belum ditinjau, hari ini s.d. 45 hari ke belakang");
  assert.deepEqual(await list("?review=VALID"), [["Budi R", "VALID"]]);
  assert.deepEqual(await list("?review=INVALID"), [], "tinjauan selesai: default 7 hari");
  assert.deepEqual(await list(`?review=INVALID&from=${addDays(today, -30)}`), [["Eka R", "INVALID"]]);
  assert.deepEqual((await list(`?review=ALL_ANOMALIES&from=${addDays(today, -46)}&to=${today}`)).map(([name]) => name).sort(), ["Ani R", "Budi R", "Citra R", "Dedi R", "Eka R"]);
  assert.equal((await callRoute(anomaliesRoute, { method: "GET", url: "/api/v1/school/attendance/anomalies?review=ALL", bearer: token })).status, 400);

  const daily = async (anomaly: string) => {
    const res = await callRoute<Envelope<Array<{ student: { name: string }; attendance: { needsReview: boolean; reviewDecision: string | null } | null }>>>(dailyRoute, {
      method: "GET", url: `/api/v1/school/attendance/daily?date=${yesterday}&anomaly=${anomaly}`, bearer: token,
    });
    assert.equal(res.status, 200, JSON.stringify(res.body?.error));
    return res.body!.data.map((r) => [r.student.name, r.attendance?.needsReview, r.attendance?.reviewDecision]);
  };
  assert.deepEqual(await daily("unreviewed"), [["Ani R", true, null]]);
  assert.deepEqual(await daily("any"), [["Ani R", true, null], ["Budi R", false, "VALID"]]);

  const map = await callRoute<Envelope<{ points: Array<{ name: string; needsReview: boolean; reviewDecision: string | null }> }>>(mapRoute, {
    method: "GET", url: `/api/v1/school/attendance/map?date=${yesterday}`, bearer: token,
  });
  assert.equal(map.status, 200, JSON.stringify(map.body?.error));
  assert.deepEqual(map.body?.data.points.map((p) => [p.name, p.needsReview, p.reviewDecision]).sort(), [["Ani R", true, null], ["Budi R", false, "VALID"], ["Fajar R", false, null]]);

  const detail = (id: string) =>
    callRoute<Envelope<{ needsReview: boolean; reviewDecision: string | null; review: ReviewDto | null }>>(detailRoute, { method: "GET", url: `/api/v1/school/attendance/${id}`, bearer: token, params: { id } });
  const reviewed = (await detail(budiRow.id)).body?.data;
  assert.deepEqual([reviewed?.needsReview, reviewed?.reviewDecision, reviewed?.review?.note, reviewed?.review?.reviewer], [false, "VALID", "Perangkat milik kakak", { id: admin.id, name: admin.name }]);
  const pending = (await detail(aniRow.id)).body?.data;
  assert.deepEqual([pending?.needsReview, pending?.reviewDecision, pending?.review], [true, null, null]);
});
