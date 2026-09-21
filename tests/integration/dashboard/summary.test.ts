/**
 * GET /school/dashboard/summary: kartu siswa per status, kehadiran hari ini (sama dengan
 * /school/attendance/stats/today), corong rapor semester, dan SPP bulan berjalan; gerbang peran &
 * isolasi dua sekolah (403 SCOPE_MISMATCH, 400 SCHOOL_ID_REQUIRED, 404 sekolah/semester asing).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET as todayStatsRoute } from "@/app/api/v1/school/attendance/stats/today/route";
import { GET as summaryRoute } from "@/app/api/v1/school/dashboard/summary/route";
import { POST as createInvoiceRoute } from "@/app/api/v1/school/invoices/route";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma } from "../helpers/db";
import { createAcademicYearWithTerm, createSchool, createSchoolAdmin, createStudent } from "../helpers/factories";
import { callRoute, type Envelope } from "../helpers/request";
import { periodAt, submitProof } from "../billing/fixtures";
import { addAttendance, createRcWorld, gradeAll, publish, superAdminToken, todayWib, webToken, withSchool, type RcWorld } from "../report-cards/helpers";

interface Summary {
  students: { active: number; inactive: number; draft: number; graduated: number; moved: number };
  attendanceToday: Record<string, unknown> & { eligible: number; present: number };
  reportCards: { term: { id: string; label: string } | null; activeStudents: number; studentsWithGrades: number; studentsComplete: number; published: number };
  billing: {
    studentsNotFullyPaid: number;
    studentsOverdue: number;
    outstandingAmount: number;
    pendingVerification: number;
    period: { periodYear: number; periodMonth: number; invoiced: number; unpaid: number; paid: number; partial: number; void: number; billedAmount: number; collectedAmount: number } | null;
  };
}

const SUMMARY_URL = "/api/v1/school/dashboard/summary";
const SPP = 150_000;

let world: RcWorld;
let otherSchoolId = "";
let otherAdminToken = "";
let otherTermId = "";
let superToken = "";

const getSummary = (token: string | undefined, query = "") =>
  callRoute<Envelope<Summary>>(summaryRoute, { method: "GET", url: `${SUMMARY_URL}${query}`, bearer: token });

async function issueInvoice(studentId: string): Promise<string> {
  const res = await callRoute<Envelope<{ id: string }>>(createInvoiceRoute, {
    method: "POST", url: "/api/v1/school/invoices", bearer: world.adminToken, json: { studentId, ...periodAt(0), amount: SPP, notify: false },
  });
  if (res.status !== 201 || !res.body) throw new Error(`issueInvoice gagal ${res.status}: ${JSON.stringify(res.body?.error)}`);
  return res.body.data.id;
}

before(async () => {
  world = await createRcWorld(3);
  await prisma.school.update({
    where: { id: world.school.id },
    data: { bankName: "Bank Uji", bankAccountNumber: "1234567890", bankAccountHolder: "Yayasan Uji", bankChangedAt: new Date(Date.now() - 60 * 86_400_000) },
  });
  for (const status of ["DRAFT", "INACTIVE", "GRADUATED", "MOVED"] as const) await createStudent(world.school.id, { status });
  const [s0, s1] = world.students as [RcWorld["students"][number], RcWorld["students"][number]];
  await addAttendance(world.school.id, s0.student.id, todayWib(), "HADIR");
  await gradeAll(world, [s0.student.id, s1.student.id], 90);
  const published = await publish(world.adminToken, { termId: world.term.id, classId: world.klass.id, studentIds: [s0.student.id] });
  assert.equal(published.status, 200, JSON.stringify(published.body?.error));
  await issueInvoice(s0.student.id);
  const pendingInvoiceId = await issueInvoice(s1.student.id);
  const submitted = await submitProof(s1, pendingInvoiceId, { amount: 50_000 });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body?.error));

  const other = await createSchool();
  otherSchoolId = other.id;
  otherAdminToken = await webToken((await createSchoolAdmin(other.id)).id);
  otherTermId = (await createAcademicYearWithTerm(other.id, { active: false })).term.id;
  superToken = await superAdminToken();
});
after(disconnect);

test("admin sekolah: ringkasan per kartu sesuai data sekolahnya", async () => {
  const res = await getSummary(world.adminToken);
  assert.equal(res.status, 200, JSON.stringify(res.body?.error));
  const data = res.body!.data;
  assert.deepEqual(data.students, { active: 3, inactive: 1, draft: 1, graduated: 1, moved: 1 });
  assert.equal(data.attendanceToday.eligible, 3);
  assert.equal(data.attendanceToday.present, 1);
  assert.deepEqual(data.reportCards, {
    term: { id: world.term.id, label: data.reportCards.term?.label ?? "" },
    activeStudents: 3,
    studentsWithGrades: 2,
    studentsComplete: 2,
    published: 1,
  });
  assert.ok(data.reportCards.term?.label);
  const { period, ...billing } = data.billing;
  assert.equal(billing.studentsNotFullyPaid, 2);
  assert.ok(billing.studentsOverdue >= 0 && billing.studentsOverdue <= 2);
  assert.equal(billing.outstandingAmount, 2 * SPP);
  assert.equal(billing.pendingVerification, 1);
  assert.deepEqual(period, { ...periodAt(0), invoiced: 2, paid: 0, partial: 0, unpaid: 2, void: 0, billedAmount: 2 * SPP, collectedAmount: 0 });
});

test("kartu kehadiran identik dengan GET /school/attendance/stats/today", async () => {
  const [summary, today] = await Promise.all([
    getSummary(world.adminToken),
    callRoute<Envelope<Record<string, unknown>>>(todayStatsRoute, { method: "GET", url: "/api/v1/school/attendance/stats/today", bearer: world.adminToken }),
  ]);
  assert.equal(today.status, 200);
  assert.deepEqual(summary.body!.data.attendanceToday, today.body!.data);
});

test("super admin: wajib schoolId (400), sekolah tak dikenal 404, dengan schoolId -> sama dengan admin sekolah", async () => {
  const missing = await getSummary(superToken);
  assert.equal(missing.status, 400);
  assert.equal(missing.body?.error?.code, "SCHOOL_ID_REQUIRED");
  const unknown = await getSummary(superToken, "?schoolId=sekolah-tidak-ada");
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body?.error?.code, "SCHOOL_NOT_FOUND");
  const [asSuper, asAdmin] = [await getSummary(superToken, withSchool("", world.school.id)), await getSummary(world.adminToken)];
  assert.equal(asSuper.status, 200);
  assert.deepEqual(asSuper.body!.data.students, asAdmin.body!.data.students);
  assert.deepEqual(asSuper.body!.data.reportCards, asAdmin.body!.data.reportCards);
  assert.deepEqual(asSuper.body!.data.billing, asAdmin.body!.data.billing);
});

test("IDOR: admin sekolah lain -> 403 SCOPE_MISMATCH; tanpa schoolId hanya melihat sekolahnya (tanpa semester aktif)", async () => {
  const cross = await getSummary(otherAdminToken, withSchool("", world.school.id));
  assert.equal(cross.status, 403);
  assert.equal(cross.body?.error?.code, "SCOPE_MISMATCH");
  const own = await getSummary(otherAdminToken);
  assert.equal(own.status, 200);
  assert.deepEqual(own.body!.data.students, { active: 0, inactive: 0, draft: 0, graduated: 0, moved: 0 });
  assert.deepEqual(own.body!.data.reportCards, { term: null, activeStudents: 0, studentsWithGrades: 0, studentsComplete: 0, published: 0 });
  assert.equal(own.body!.data.billing.pendingVerification, 0);
  assert.equal(own.body!.data.billing.period?.invoiced, 0);
  const superOther = await getSummary(superToken, withSchool("", otherSchoolId));
  assert.equal(superOther.status, 200);
  assert.deepEqual(superOther.body!.data.students, own.body!.data.students);
});

test("termId: milik sekolah lain -> 404; semester sendiri non-aktif dipakai; terlalu panjang -> 400", async () => {
  const foreign = await getSummary(world.adminToken, `?termId=${otherTermId}`);
  assert.equal(foreign.status, 404);
  const ownInactive = await getSummary(otherAdminToken, `?termId=${otherTermId}`);
  assert.equal(ownInactive.status, 200);
  assert.equal(ownInactive.body!.data.reportCards.term?.id, otherTermId);
  const invalid = await getSummary(world.adminToken, `?termId=${"x".repeat(65)}`);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body?.error?.code, "VALIDATION_FAILED");
});

test("gerbang peran: tanpa token 401, siswa 403", async () => {
  const anonymous = await getSummary(undefined);
  assert.equal(anonymous.status, 401);
  const student = world.students[2]!;
  const asStudent = await getSummary((await createSessionToken(student.user.id)).token);
  assert.equal(asStudent.status, 403);
  assert.equal(asStudent.body?.error?.code, "FORBIDDEN");
});
