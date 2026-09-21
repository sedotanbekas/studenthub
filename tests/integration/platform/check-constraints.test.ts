/**
 * Satu test per CHECK constraint migrasi init (docs/PLAN.md "Verifikasi"): setiap INSERT/UPDATE
 * pelanggar DITOLAK MariaDB (errno 4025 + nama constraint) dan, bila murah, baris valid lolos.
 * Tabel kasus WAJIB mencakup persis semua `chk_*` di migration.sql (diperiksa test cakupan).
 * Catatan: log "prisma:error" di stderr berasal dari pelanggaran yang memang diharapkan.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { isCheckViolation } from "../../../src/lib/http/prisma-errors";
import { toDbDate } from "../../../src/lib/time/zone";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSponsor, createStoredFile, createStudent, uniqEmail, uniqNisn } from "../helpers/factories";
import { AD_END, AD_START, buildCheckFixture, type CheckFixture } from "./check-fixture";
import { adLedgerCases, attendanceCases, billingCases, type CheckCase } from "./check-cases";

after(disconnect);

const MARIADB_CHECK_ERRNO = "4025";
const INIT_MIGRATION = "prisma/migrations/20260921000000_init/migration.sql";

let fx: CheckFixture;
before(async () => {
  fx = await buildCheckFixture();
});

function errorText(error: unknown): string {
  const meta = (error as { meta?: unknown } | null)?.meta;
  const message = error instanceof Error ? error.message : String(error);
  return `${message}\n${JSON.stringify(meta ?? {})}`;
}

/** Operasi wajib ditolak MariaDB karena constraint `name` (bukan constraint lain / error lain). */
async function expectCheckViolation(name: string, action: () => Promise<unknown>): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    const text = errorText(error);
    assert.ok(text.includes(MARIADB_CHECK_ERRNO), `bukan errno 4025: ${text.slice(0, 300)}`);
    assert.ok(text.includes(`CONSTRAINT \`${name}\``), `constraint lain/pesan tak terduga: ${text.slice(0, 300)}`);
    assert.ok(isCheckViolation(error), "src/lib/http/prisma-errors isCheckViolation harus mengenali error ini");
    return true;
  });
}

const updateSchool = (data: Parameters<typeof prisma.school.update>[0]["data"]) =>
  prisma.school.update({ where: { id: fx.school.id }, data });
const updateStudent = (data: Parameters<typeof prisma.student.update>[0]["data"]) =>
  prisma.student.update({ where: { id: fx.student.id }, data });

const SCHOOL_CASES: readonly CheckCase[] = [
  {
    constraint: "chk_user_scope",
    violations: [
      () => prisma.user.create({ data: { role: "STUDENT", name: "x", passwordHash: "x", email: uniqEmail("s"), schoolId: fx.school.id } }),
      () => prisma.user.create({ data: { role: "SUPER_ADMIN", name: "x", passwordHash: "x", email: uniqEmail("sa"), schoolId: fx.school.id } }),
      () => prisma.user.create({ data: { role: "SCHOOL_ADMIN", name: "x", passwordHash: "x", email: uniqEmail("adm") } }),
      () => prisma.user.create({ data: { role: "SPONSOR", name: "x", passwordHash: "x", email: uniqEmail("sp") } }),
      () => prisma.user.create({ data: { role: "SUPER_ADMIN", name: "x", passwordHash: "x", email: null } }),
    ],
    valid: () => createSchoolAdmin(fx.school.id),
  },
  {
    constraint: "chk_school_schedule",
    violations: [
      () => updateSchool({ checkInOpenMinute: 420 }),
      () => updateSchool({ startMinute: 590 }),
      () => updateSchool({ dayEndMinute: 1440 }),
      () => updateSchool({ checkInCloseMinute: 1000 }),
    ],
    valid: () =>
      createSchool({ data: { checkInOpenMinute: 0, startMinute: 390, lateToleranceMinutes: 10, checkInCloseMinute: 401, dayEndMinute: 1439 } }),
  },
  {
    constraint: "chk_school_radius",
    violations: [() => updateSchool({ geofenceRadiusM: 49 }), () => updateSchool({ geofenceRadiusM: 1001 })],
    valid: () => createSchool({ data: { geofenceRadiusM: 1000 } }),
  },
  {
    constraint: "chk_school_tolerance",
    violations: [() => updateSchool({ lateToleranceMinutes: 121 }), () => updateSchool({ lateToleranceMinutes: -1 })],
    valid: () => createSchool({ data: { lateToleranceMinutes: 120, checkInCloseMinute: 600 } }),
  },
  {
    constraint: "chk_school_days",
    violations: [() => updateSchool({ schoolDaysMask: 0 }), () => updateSchool({ schoolDaysMask: -1 })],
    valid: () => createSchool({ data: { schoolDaysMask: 127 } }),
  },
  {
    constraint: "chk_school_bank",
    violations: [
      () => updateSchool({ bankName: "BRI" }),
      () => updateSchool({ bankName: "BRI", bankAccountNumber: "0123456789" }),
    ],
    valid: () => createSchool({ data: { bankName: "BRI", bankAccountNumber: "0123456789", bankAccountHolder: "Sekolah Test" } }),
  },
  {
    constraint: "chk_holiday_range",
    violations: [
      () => prisma.holiday.create({ data: { schoolId: fx.school.id, name: "x", startDate: toDbDate("2026-09-22"), endDate: toDbDate("2026-09-21") } }),
    ],
    valid: () =>
      prisma.holiday.create({ data: { schoolId: fx.school.id, name: "x", startDate: toDbDate("2026-09-21"), endDate: toDbDate("2026-09-21") } }),
  },
  {
    constraint: "chk_academic_year_range",
    violations: [
      () => prisma.academicYear.create({ data: { schoolId: fx.school.id, name: "2030/2031", startDate: toDbDate("2030-07-01"), endDate: toDbDate("2030-07-01") } }),
    ],
    valid: () =>
      prisma.academicYear.create({ data: { schoolId: fx.school.id, name: "2031/2032", startDate: toDbDate("2031-07-01"), endDate: toDbDate("2031-07-02") } }),
  },
  {
    constraint: "chk_term_range",
    violations: [
      () =>
        prisma.term.create({
          data: { schoolId: fx.school.id, academicYearId: fx.academicYear.id, semester: "GENAP", startDate: toDbDate("2027-01-04"), endDate: toDbDate("2027-01-03") },
        }),
    ],
    valid: () =>
      prisma.term.create({
        data: { schoolId: fx.school.id, academicYearId: fx.academicYear.id, semester: "GENAP", startDate: toDbDate("2027-01-04"), endDate: toDbDate("2027-06-26") },
      }),
  },
  {
    constraint: "chk_subject_kkm",
    violations: [
      () => prisma.subject.create({ data: { schoolId: fx.school.id, code: uniq("k"), name: "x", kkm: 101 } }),
      () => prisma.subject.create({ data: { schoolId: fx.school.id, code: uniq("k"), name: "x", kkm: -1 } }),
    ],
    valid: () => prisma.subject.create({ data: { schoolId: fx.school.id, code: uniq("k"), name: "x", kkm: 100 } }),
  },
  {
    constraint: "chk_class_grade_level",
    violations: [
      () => prisma.schoolClass.create({ data: { schoolId: fx.school.id, academicYearId: fx.academicYear.id, name: uniq("c"), gradeLevel: 0 } }),
      () => prisma.schoolClass.create({ data: { schoolId: fx.school.id, academicYearId: fx.academicYear.id, name: uniq("c"), gradeLevel: 13 } }),
    ],
    valid: () => prisma.schoolClass.create({ data: { schoolId: fx.school.id, academicYearId: fx.academicYear.id, name: uniq("c"), gradeLevel: 12 } }),
  },
];

function studentWithActiveNisn(status: "DRAFT" | "MOVED"): () => Promise<unknown> {
  return () => {
    const nisn = uniqNisn();
    return createStudent(fx.school.id, { status, nisn, data: { activeNisn: nisn } });
  };
}

const STUDENT_CASES: readonly CheckCase[] = [
  {
    constraint: "chk_student_spp",
    violations: [() => updateStudent({ sppAmount: -1 }), () => updateStudent({ sppAmount: 50_000_001 })],
    valid: async () => {
      await updateStudent({ sppAmount: 50_000_000 });
      await updateStudent({ sppAmount: 0 });
    },
  },
  {
    constraint: "chk_student_active_nisn",
    violations: [
      () => updateStudent({ activeNisn: null }),
      () => updateStudent({ activeNisn: uniqNisn() }),
      studentWithActiveNisn("DRAFT"),
      studentWithActiveNisn("MOVED"),
      () => createStudent(fx.school.id, { status: "INACTIVE", data: { activeNisn: null } }),
    ],
    valid: async () => {
      await createStudent(fx.school.id, { status: "DRAFT" });
      await createStudent(fx.school.id, { status: "MOVED" });
      await createStudent(fx.school.id, { status: "GRADUATED", data: { activeNisn: null } });
    },
  },
  {
    constraint: "chk_grade_score",
    violations: [
      () =>
        prisma.reportCardGrade.create({
          data: { reportCardId: fx.reportCard.id, subjectId: fx.subject.id, subjectNameSnapshot: "x", kkmSnapshot: 75, score: 101, predicate: "A" },
        }),
      () =>
        prisma.reportCardGrade.create({
          data: { reportCardId: fx.reportCard.id, subjectId: fx.subject.id, subjectNameSnapshot: "x", kkmSnapshot: 101, score: 80, predicate: "B" },
        }),
      () =>
        prisma.reportCardGrade.create({
          data: { reportCardId: fx.reportCard.id, subjectId: fx.subject.id, subjectNameSnapshot: "x", kkmSnapshot: -1, score: 80, predicate: "B" },
        }),
    ],
    valid: () =>
      prisma.reportCardGrade.create({
        data: { reportCardId: fx.reportCard.id, subjectId: fx.subject.id, subjectNameSnapshot: "x", kkmSnapshot: 75, score: 100, predicate: "A" },
      }),
  },
];

const SPONSOR_CASES: readonly CheckCase[] = [
  {
    constraint: "chk_announcement_target_one",
    violations: [
      () => prisma.announcementTarget.create({ data: { announcementId: fx.announcement.id } }),
      () => prisma.announcementTarget.create({ data: { announcementId: fx.announcement.id, classId: fx.schoolClass.id, studentId: fx.student.id } }),
    ],
    valid: () => prisma.announcementTarget.create({ data: { announcementId: fx.announcement.id, classId: fx.schoolClass.id } }),
  },
  {
    constraint: "chk_sponsor_balance",
    violations: [
      () => prisma.sponsor.update({ where: { id: fx.sponsor.id }, data: { balance: -1 } }),
      () => createSponsor({ data: { balance: -500 } }),
    ],
    valid: () => createSponsor({ data: { balance: 0 } }),
  },
  {
    constraint: "chk_ad_cpc",
    violations: [
      () => prisma.ad.update({ where: { id: fx.ad.id }, data: { cpcAmount: 99 } }),
      () => prisma.ad.update({ where: { id: fx.ad.id }, data: { cpcAmount: 100_001 } }),
    ],
    valid: async () => {
      await prisma.ad.update({ where: { id: fx.ad.id }, data: { cpcAmount: 100 } });
      await prisma.ad.update({ where: { id: fx.ad.id }, data: { cpcAmount: 100_000 } });
      await prisma.ad.update({ where: { id: fx.ad.id }, data: { cpcAmount: 500 } });
    },
  },
  {
    constraint: "chk_ad_schedule",
    violations: [
      () => prisma.ad.update({ where: { id: fx.ad.id }, data: { endAt: AD_START } }),
      () => prisma.ad.update({ where: { id: fx.ad.id }, data: { startAt: AD_END, endAt: AD_START } }),
    ],
    valid: () => prisma.ad.update({ where: { id: fx.ad.id }, data: { startAt: AD_START, endAt: AD_END } }),
  },
  {
    constraint: "chk_ad_target_one",
    violations: [
      () => prisma.adTarget.create({ data: { adId: fx.ad.id } }),
      () => prisma.adTarget.create({ data: { adId: fx.ad.id, provinceCode: "32", cityCode: "32.73" } }),
      () => prisma.adTarget.create({ data: { adId: fx.ad.id, provinceCode: "32", schoolId: fx.school.id } }),
    ],
    valid: () => prisma.adTarget.create({ data: { adId: fx.ad.id, cityCode: "32.73" } }),
  },
  {
    constraint: "chk_topup_amount",
    violations: [
      async () => {
        const proof = await createStoredFile(fx.sponsorUser.id, "TOPUP_PROOF", { sponsorId: fx.sponsor.id });
        return prisma.topUpRequest.create({
          data: { sponsorId: fx.sponsor.id, amount: 0, transferDate: toDbDate("2026-09-21"), senderName: "x", senderBank: "BCA", proofFileId: proof.id },
        });
      },
    ],
    valid: async () => {
      const proof = await createStoredFile(fx.sponsorUser.id, "TOPUP_PROOF", { sponsorId: fx.sponsor.id });
      return prisma.topUpRequest.create({
        data: { sponsorId: fx.sponsor.id, amount: 100_000, transferDate: toDbDate("2026-09-21"), senderName: "x", senderBank: "BCA", proofFileId: proof.id },
      });
    },
  },
  {
    constraint: "chk_platform_setting",
    violations: [
      () => prisma.platformSetting.update({ where: { id: 1 }, data: { defaultCpcAmount: 99 } }),
      () => prisma.platformSetting.update({ where: { id: 1 }, data: { defaultCpcAmount: 100_001 } }),
      () => prisma.platformSetting.update({ where: { id: 1 }, data: { minTopUpAmount: 9_999 } }),
      () => prisma.platformSetting.create({ data: { id: 2, defaultCpcAmount: 500, minTopUpAmount: 100_000, deepLinkSchemes: [] } }),
    ],
  },
];

const ALL_CASES: readonly CheckCase[] = [
  ...SCHOOL_CASES,
  ...STUDENT_CASES,
  ...attendanceCases(() => fx),
  ...billingCases(() => fx),
  ...adLedgerCases(() => fx),
  ...SPONSOR_CASES,
];

describe("platform: CHECK constraint MariaDB", () => {
  for (const item of ALL_CASES) {
    test(`${item.constraint} menolak ${item.violations.length} pelanggaran${item.valid ? " dan menerima baris valid" : ""}`, async () => {
      for (const violation of item.violations) await expectCheckViolation(item.constraint, violation);
      if (item.valid) await item.valid();
    });
    for (const gap of item.knownGaps ?? []) {
      const todo = `celah migrasi: ${item.constraint} belum menolak ${gap.description}`;
      test(`${item.constraint} menolak ${gap.description}`, { todo }, async () => {
        await expectCheckViolation(item.constraint, gap.action);
      });
    }
  }
});

describe("platform: cakupan test CHECK constraint", () => {
  test("tabel kasus mencakup persis semua chk_* di migrasi init (tanpa duplikat)", async () => {
    const sql = await readFile(resolve(process.cwd(), INIT_MIGRATION), "utf8");
    const declared = [...sql.matchAll(/ADD CONSTRAINT `(chk_[a-z0-9_]+)` CHECK/g)].map((m) => m[1]).sort();
    const tested = ALL_CASES.map((c) => c.constraint).sort();
    assert.equal(new Set(tested).size, tested.length, "ada constraint yang diuji dua kali");
    assert.deepEqual(tested, declared);
  });

  test("database memuat persis constraint chk_* yang sama (information_schema)", async () => {
    const rows = await prisma.$queryRaw<{ name: string }[]>`
      SELECT CONSTRAINT_NAME AS name FROM information_schema.CHECK_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME LIKE 'chk\\_%'`;
    const inDb = rows.map((r) => r.name).sort();
    assert.deepEqual(inDb, ALL_CASES.map((c) => c.constraint).sort());
  });
});
