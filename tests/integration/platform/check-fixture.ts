/**
 * Fixture bersama untuk check-constraints.test.ts: satu set baris induk valid (sekolah, siswa,
 * tagihan, sponsor, iklan, ...) yang dipakai kasus pelanggaran CHECK. Dibuat ulang setiap run
 * dengan data unik, jadi aman pada database yang tidak di-reset.
 */
import type {
  AcademicYear,
  Ad,
  Announcement,
  Invoice,
  LeaveRequest,
  Prisma,
  ReportCard,
  School,
  SchoolClass,
  Sponsor,
  Student,
  Subject,
  Term,
} from "@prisma/client";
import { addDays, toDbDate } from "../../../src/lib/time/zone";
import { prisma, uniq } from "../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createSponsor,
  createStoredFile,
  createStudent,
  createSuperAdmin,
  type TestUser,
} from "../helpers/factories";

export interface CheckFixture {
  readonly school: School;
  readonly admin: TestUser;
  readonly superAdmin: TestUser;
  readonly academicYear: AcademicYear;
  readonly term: Term;
  readonly schoolClass: SchoolClass;
  readonly student: Student;
  readonly studentUser: TestUser;
  readonly subject: Subject;
  readonly reportCard: ReportCard;
  readonly leaveRequest: LeaveRequest;
  /** Tagihan Januari 2026 (UNPAID). */
  readonly invoice: Invoice;
  /** Tagihan Februari 2026 (UNPAID), untuk kasus pendingInvoiceId != invoiceId. */
  readonly otherInvoice: Invoice;
  readonly announcement: Announcement;
  readonly sponsor: Sponsor;
  readonly sponsorUser: TestUser;
  readonly ad: Ad;
}

export const AD_START = new Date("2026-09-01T00:00:00.000Z");
export const AD_END = new Date("2026-12-31T00:00:00.000Z");
export const INVOICE_AMOUNT = 100_000;

let dateSeq = 0;

/** Tanggal @db.Date unik per pemanggilan (hindari bentrok unik studentId+date / adId+date). */
export function nextDate(): Date {
  dateSeq += 1;
  return toDbDate(addDays("2026-08-03", dateSeq));
}

/** Data Invoice valid (UNPAID); override untuk membuat pelanggaran. */
export function invoiceData(
  fx: Pick<CheckFixture, "school" | "student">,
  overrides: Partial<Prisma.InvoiceUncheckedCreateInput> = {},
): Prisma.InvoiceUncheckedCreateInput {
  return {
    schoolId: fx.school.id,
    studentId: fx.student.id,
    invoiceNo: uniq("I"),
    periodYear: 2026,
    periodMonth: 12,
    title: "SPP Test",
    amount: INVOICE_AMOUNT,
    dueDate: toDbDate("2026-01-10"),
    ...overrides,
  };
}

async function buildSchoolSide() {
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const { academicYear, term } = await createAcademicYearWithTerm(school.id);
  const schoolClass = await createClass(school.id, academicYear.id);
  const { student, user: studentUser } = await createStudent(school.id, { classId: schoolClass.id });
  const subject = await prisma.subject.create({ data: { schoolId: school.id, code: uniq("m"), name: "Matematika" } });
  const reportCard = await prisma.reportCard.create({
    data: {
      schoolId: school.id,
      studentId: student.id,
      termId: term.id,
      classId: schoolClass.id,
      classNameSnapshot: schoolClass.name,
    },
  });
  return { school, admin, academicYear, term, schoolClass, student, studentUser, subject, reportCard };
}

type SchoolSide = Awaited<ReturnType<typeof buildSchoolSide>>;

async function buildRecords(side: SchoolSide) {
  const leaveRequest = await prisma.leaveRequest.create({
    data: {
      schoolId: side.school.id,
      studentId: side.student.id,
      type: "IZIN",
      startDate: toDbDate("2026-09-21"),
      endDate: toDbDate("2026-09-22"),
      reason: "Acara keluarga",
    },
  });
  const invoice = await prisma.invoice.create({ data: invoiceData(side, { periodMonth: 1 }) });
  const otherInvoice = await prisma.invoice.create({ data: invoiceData(side, { periodMonth: 2 }) });
  const announcement = await prisma.announcement.create({
    data: {
      schoolId: side.school.id,
      authorId: side.admin.id,
      category: "ACADEMIC",
      title: "Pengumuman test",
      body: "Isi",
      audience: "CLASSES",
    },
  });
  return { leaveRequest, invoice, otherInvoice, announcement };
}

async function buildSponsorSide() {
  const superAdmin = await createSuperAdmin();
  const { sponsor, user: sponsorUser } = await createSponsor();
  const banner = await createStoredFile(sponsorUser.id, "AD_BANNER", { sponsorId: sponsor.id });
  const ad = await prisma.ad.create({
    data: {
      sponsorId: sponsor.id,
      title: "Iklan test",
      imageFileId: banner.id,
      targetUrl: "https://example.com",
      linkType: "EXTERNAL_URL",
      startAt: AD_START,
      endAt: AD_END,
      cpcAmount: 500,
    },
  });
  return { superAdmin, sponsor, sponsorUser, ad };
}

export async function buildCheckFixture(): Promise<CheckFixture> {
  const side = await buildSchoolSide();
  const records = await buildRecords(side);
  const sponsorSide = await buildSponsorSide();
  return { ...side, ...records, ...sponsorSide };
}
