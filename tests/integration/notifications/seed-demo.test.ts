/**
 * Seed demo dijalankan DUA KALI terhadap database test (fungsi diimpor, bukan CLI):
 * jumlah baris & id harus identik (idempoten, upsert berdasarkan kunci alami).
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { verifyPassword } from "@/lib/auth/password";
import { fromDbDate } from "@/lib/time/zone";
import { DEMO_SCHOOLS, DEMO_SUPER_ADMIN, demoAdminEmail } from "../../../scripts/lib/demo-data";
import { runDemoSeed } from "../../../scripts/lib/demo-seed";
import { disconnect, prisma } from "../helpers/db";
import { hashTestPassword } from "../helpers/factories";

after(disconnect);

const DEMO_TEST_PASSWORD = "DemoSeed123";
const NPSNS = DEMO_SCHOOLS.map((s) => s.npsn);
const STAFF_EMAILS = [DEMO_SUPER_ADMIN.email, ...DEMO_SCHOOLS.map((s) => demoAdminEmail(s))];

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
