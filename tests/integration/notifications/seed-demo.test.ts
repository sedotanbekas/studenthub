/**
 * Seed demo dijalankan DUA KALI terhadap database test (fungsi diimpor, bukan CLI):
 * jumlah baris & id harus identik (idempoten, upsert berdasarkan kunci alami), termasuk data P3
 * (tagihan/pembayaran/bukti SPP, rapor, pengumuman, notifikasi, penghitung nomor dokumen) dan data P4
 * (sponsor, top-up, iklan, klik & ledger).
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { verifyPassword } from "@/lib/auth/password";
import { fromDbDate } from "@/lib/time/zone";
import { DEMO_SCHOOLS, DEMO_SUPER_ADMIN, demoAdminEmail } from "../../../scripts/lib/demo-data";
import { runDemoSeed } from "../../../scripts/lib/demo-seed";
import { DEMO_ADS, DEMO_SPONSOR } from "../../../scripts/lib/demo-sponsor-plan";
import { disconnect, prisma } from "../helpers/db";
import { hashTestPassword } from "../helpers/factories";
import { createTempStorage, type TempStorage } from "../helpers/storage";

let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const DEMO_TEST_PASSWORD = "DemoSeed123";
const NPSNS = DEMO_SCHOOLS.map((s) => s.npsn);
const STAFF_EMAILS = [DEMO_SUPER_ADMIN.email, ...DEMO_SCHOOLS.map((s) => demoAdminEmail(s))];

async function snapshotP3(schoolIds: string[]) {
  const inSchools = { schoolId: { in: schoolIds } };
  const byId = { orderBy: { id: "asc" as const } };
  return {
    invoices: await prisma.invoice.findMany({ where: inSchools, ...byId, select: { id: true, invoiceNo: true, status: true, paidAmount: true } }),
    payments: await prisma.payment.findMany({ where: inSchools, ...byId, select: { id: true, receiptNo: true } }),
    submissions: await prisma.paymentSubmission.findMany({ where: inSchools, ...byId, select: { id: true, status: true } }),
    reportCards: await prisma.reportCard.findMany({ where: inSchools, ...byId, select: { id: true, status: true } }),
    grades: await prisma.reportCardGrade.count({ where: { reportCard: inSchools } }),
    announcements: await prisma.announcement.findMany({ where: inSchools, ...byId, select: { id: true, status: true, recipientCount: true } }),
    notifications: await prisma.notification.count({ where: { user: inSchools } }),
    counters: await prisma.documentCounter.findMany({ where: inSchools, orderBy: [{ schoolId: "asc" }, { kind: "asc" }], select: { kind: true, year: true, lastValue: true } }),
  };
}

async function snapshot() {
  const schools = await prisma.school.findMany({ where: { npsn: { in: NPSNS } }, orderBy: { npsn: "asc" }, select: { id: true, activeTermId: true } });
  const schoolIds = schools.map((s) => s.id);
  const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((r) => r.id);
  return {
    schools,
    years: await ids(prisma.academicYear.findMany({ where: { schoolId: { in: schoolIds } }, orderBy: { id: "asc" }, select: { id: true } })),
    terms: await ids(prisma.term.findMany({ where: { schoolId: { in: schoolIds } }, orderBy: { id: "asc" }, select: { id: true } })),
    classes: await ids(prisma.schoolClass.findMany({ where: { schoolId: { in: schoolIds } }, orderBy: { id: "asc" }, select: { id: true } })),
    subjects: await ids(prisma.subject.findMany({ where: { schoolId: { in: schoolIds } }, orderBy: { id: "asc" }, select: { id: true } })),
    classSubjects: await prisma.classSubject.count({ where: { schoolClass: { schoolId: { in: schoolIds } } } }),
    students: await ids(prisma.student.findMany({ where: { schoolId: { in: schoolIds } }, orderBy: { id: "asc" }, select: { id: true } })),
    staff: await ids(prisma.user.findMany({ where: { email: { in: STAFF_EMAILS } }, orderBy: { id: "asc" }, select: { id: true } })),
    studentUsers: await prisma.user.count({ where: { schoolId: { in: schoolIds }, role: "STUDENT" } }),
    p3: await snapshotP3(schoolIds),
  };
}

test("seed demo idempoten: dua kali jalan menghasilkan baris & id yang sama", async () => {
  const passwordHash = await hashTestPassword(DEMO_TEST_PASSWORD);
  const first = await runDemoSeed({ passwordHash });
  const afterFirst = await snapshot();
  const second = await runDemoSeed({ passwordHash });
  const afterSecond = await snapshot();
  assert.deepEqual(second, first);
  assert.deepEqual(afterSecond, afterFirst);

  assert.equal(afterFirst.schools.length, 2);
  assert.equal(afterFirst.years.length, 2);
  assert.equal(afterFirst.terms.length, 4);
  assert.equal(afterFirst.classes.length, 6);
  assert.equal(afterFirst.subjects.length, 12);
  assert.equal(afterFirst.classSubjects, 36);
  assert.equal(afterFirst.students.length, 30);
  assert.equal(afterFirst.studentUsers, 30);
  assert.equal(afterFirst.staff.length, 3);
  assert.deepEqual(
    first.schools.map((s) => [s.npsn, s.classes, s.subjects, s.classSubjects, s.activeStudents]),
    NPSNS.map((npsn) => [npsn, 3, 6, 18, 15]),
  );
  assert.equal(first.superAdminEmail, DEMO_SUPER_ADMIN.email);
});

test("seed demo: semester Ganjil aktif, sekolah WIB & WIT lengkap dengan rekening", async () => {
  await runDemoSeed({ passwordHash: await hashTestPassword(DEMO_TEST_PASSWORD) });
  for (const spec of DEMO_SCHOOLS) {
    const school = await prisma.school.findUniqueOrThrow({ where: { npsn: spec.npsn }, include: { activeTerm: true } });
    assert.equal(school.timezone, spec.timezone);
    assert.equal(school.cityCode, spec.cityCode);
    assert.equal(school.geofenceRadiusM, 150);
    assert.equal(school.bankName, spec.bank.bankName);
    assert.equal(school.activeTerm?.semester, "GANJIL");
    assert.equal(school.activeTerm && fromDbDate(school.activeTerm.startDate), "2026-07-13");
    assert.equal(school.activeTerm && fromDbDate(school.activeTerm.endDate), "2026-12-19");
    const subjects = await prisma.subject.findMany({ where: { schoolId: school.id } });
    assert.ok(subjects.every((s) => s.kkm === 75 && s.isActive));
  }
});

test("seed demo: akun siswa aktif siap login (activeNisn, kelas tahun aktif) dan akun staf memakai DEMO_PASSWORD", async () => {
  await runDemoSeed({ passwordHash: await hashTestPassword(DEMO_TEST_PASSWORD) });
  const spec = DEMO_SCHOOLS[1];
  assert.ok(spec);
  const school = await prisma.school.findUniqueOrThrow({ where: { npsn: spec.npsn }, include: { activeTerm: true } });
  const students = await prisma.student.findMany({
    where: { schoolId: school.id, nisn: { in: spec.students.map((s) => s.nisn) } },
    include: { user: { omit: { passwordHash: false } }, currentClass: true },
  });
  assert.equal(students.length, 15);
  for (const st of students) {
    assert.equal(st.status, "ACTIVE");
    assert.equal(st.activeNisn, st.nisn);
    assert.ok(st.activatedAt);
    assert.equal(st.sppAmount, null);
    assert.equal(st.currentClass?.academicYearId, school.activeTerm?.academicYearId);
    assert.equal(st.user.isActive, true);
    assert.equal(st.user.mustChangePassword, false);
    assert.equal(st.user.email, null);
  }
  const sample = students[0];
  assert.ok(sample && (await verifyPassword(DEMO_TEST_PASSWORD, sample.user.passwordHash)));
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: demoAdminEmail(spec) }, omit: { passwordHash: false } });
  assert.equal(admin.role, "SCHOOL_ADMIN");
  assert.equal(admin.schoolId, school.id);
  assert.equal(await verifyPassword(DEMO_TEST_PASSWORD, admin.passwordHash), true);
  const sa = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_SUPER_ADMIN.email } });
  assert.equal(sa.role, "SUPER_ADMIN");
  assert.equal(sa.schoolId, null);
});

/** Nomor urut dokumen (INV-/KWT-YYYY-NNNNNN) terurut; harus 1..N tanpa celah. */
const sequenceOf = (numbers: readonly string[]): number[] => numbers.map((n) => Number(n.slice(-6))).sort((a, b) => a - b);
const oneToN = (n: number): number[] => Array.from({ length: n }, (_, i) => i + 1);

test("seed demo P3: SPP Juli-September (lunas/sebagian/belum + 1 menunggu), rapor Ganjil terbit, 3 pengumuman", async () => {
  const summary = await runDemoSeed({ passwordHash: await hashTestPassword(DEMO_TEST_PASSWORD) });
  for (const [index, spec] of DEMO_SCHOOLS.entries()) {
    const s = summary.schools[index]!;
    assert.deepEqual(s.warnings, []);
    assert.deepEqual(s.billing, { invoices: 45, paid: 21, partial: 8, unpaid: 16, payments: 29, pendingSubmissions: 1 });
    assert.deepEqual(s.reportCards, { className: spec.classes[0]!.name, published: 5 });
    assert.equal(s.announcements, 3);

    const school = await prisma.school.findUniqueOrThrow({ where: { npsn: spec.npsn }, select: { id: true } });
    const invoices = await prisma.invoice.findMany({ where: { schoolId: school.id }, select: { invoiceNo: true, amount: true, periodMonth: true, periodYear: true } });
    assert.ok(invoices.every((i) => i.amount === spec.sppAmount && i.periodYear === 2026 && [7, 8, 9].includes(i.periodMonth)));
    assert.deepEqual(sequenceOf(invoices.map((i) => i.invoiceNo)), oneToN(45));
    const payments = await prisma.payment.findMany({ where: { schoolId: school.id }, select: { receiptNo: true, method: true, paidDate: true, invoice: { select: { periodMonth: true } } } });
    assert.deepEqual(sequenceOf(payments.map((p) => p.receiptNo)), oneToN(29));
    assert.ok(payments.every((p) => p.method === "CASH" && p.paidDate.getUTCMonth() + 1 === p.invoice.periodMonth));

    const pending = await prisma.paymentSubmission.findFirstOrThrow({ where: { schoolId: school.id, status: "PENDING" }, select: { proofFile: { select: { kind: true } }, invoice: { select: { periodMonth: true } } } });
    assert.equal(pending.proofFile.kind, "PAYMENT_PROOF");
    assert.equal(pending.invoice.periodMonth, 9);

    const cards = await prisma.reportCard.findMany({ where: { schoolId: school.id, status: "PUBLISHED" }, select: { classNameSnapshot: true, sickDays: true, _count: { select: { grades: true } } } });
    assert.equal(cards.length, 5);
    assert.ok(cards.every((c) => c.classNameSnapshot === spec.classes[0]!.name && c._count.grades === 6 && c.sickDays !== null));

    const announcements = await prisma.announcement.findMany({ where: { schoolId: school.id }, orderBy: { audience: "asc" }, select: { audience: true, status: true, recipientCount: true } });
    assert.deepEqual(
      announcements.map((a) => [a.audience, a.status, a.recipientCount]),
      [["ALL", "PUBLISHED", 15], ["CLASSES", "PUBLISHED", 5], ["STUDENTS", "PUBLISHED", 3]],
    );
  }
});

test("seed demo P4: sponsor APPROVED, top-up disetujui + menunggu, 2 iklan dengan trafik 14 hari, saldo == ledger, idempoten", async () => {
  const passwordHash = await hashTestPassword(DEMO_TEST_PASSWORD);
  const first = await runDemoSeed({ passwordHash });
  const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_SPONSOR.email }, select: { sponsorId: true, role: true } });
  const sponsorId = user.sponsorId ?? "";
  const count = async () => ({
    topUps: await prisma.topUpRequest.groupBy({ by: ["status"], where: { sponsorId }, _count: { _all: true }, orderBy: { status: "asc" } }),
    ads: await prisma.ad.count({ where: { sponsorId } }),
    clicks: await prisma.adClick.count({ where: { sponsorId } }),
    ledger: await prisma.sponsorLedgerEntry.count({ where: { sponsorId } }),
    stats: await prisma.adDailyStat.count({ where: { sponsorId } }),
  });
  const before = await count();
  const second = await runDemoSeed({ passwordHash });
  assert.deepEqual(await count(), before);
  assert.deepEqual(second.sponsor, first.sponsor);
  assert.equal(user.role, "SPONSOR");
  assert.equal((await prisma.sponsor.findFirstOrThrow({ where: { id: sponsorId } })).status, "APPROVED");
  assert.deepEqual(before.topUps.map((g) => `${g.status}:${g._count._all}`).sort(), ["APPROVED:1", "PENDING:1"]);
  assert.equal(before.ads, DEMO_ADS.length);
  assert.ok(before.clicks > 0 && before.stats >= DEMO_ADS.length);
  const [sponsor, sum, charged] = await Promise.all([
    prisma.sponsor.findFirstOrThrow({ where: { id: sponsorId }, select: { balance: true } }),
    prisma.sponsorLedgerEntry.aggregate({ where: { sponsorId }, _sum: { amount: true } }),
    prisma.adClick.count({ where: { sponsorId, billing: "CHARGED" } }),
  ]);
  assert.equal(sponsor.balance, sum._sum.amount);
  assert.ok(charged > 0);
  assert.equal(sponsor.balance, 2_000_000 - charged * 500);
  assert.deepEqual(first.sponsor.warnings, []);
});
