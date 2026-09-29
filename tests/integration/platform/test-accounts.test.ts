/**
 * Akun uji (`pnpm db:akun-uji`) dijalankan DUA KALI terhadap database test (fungsi diimpor, bukan CLI):
 * semua peran dapat masuk dengan kata sandi yang sama, id stabil (idempoten), dan seed ulang mengaktifkan
 * kembali akun yang dinonaktifkan serta me-reset kata sandinya.
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { verifyPassword } from "@/lib/auth/password";
import { demoAdminEmail } from "../../../scripts/lib/demo-data";
import { runTestAccountsSeed } from "../../../scripts/lib/test-accounts";
import { TEST_SCHOOL, TEST_SPONSOR, TEST_SUPER_ADMIN } from "../../../scripts/lib/test-accounts-plan";
import { disconnect, prisma } from "../helpers/db";
import { hashTestPassword } from "../helpers/factories";

after(async () => {
  await disconnect();
});

const PASSWORD = "AkunUji-2026";
const NISNS = TEST_SCHOOL.students.map((s) => s.nisn);

async function snapshot() {
  const staff = await prisma.user.findMany({
    where: { email: { in: [TEST_SUPER_ADMIN.email, demoAdminEmail(TEST_SCHOOL), TEST_SPONSOR.email] } },
    orderBy: { email: "asc" },
    select: { id: true, email: true, role: true, isActive: true, mustChangePassword: true, passwordHash: true, schoolId: true, sponsorId: true },
  });
  const school = await prisma.school.findUniqueOrThrow({ where: { npsn: TEST_SCHOOL.npsn }, select: { id: true, isActive: true } });
  const students = await prisma.student.findMany({
    where: { schoolId: school.id, nisn: { in: NISNS } },
    orderBy: { nisn: "asc" },
    select: { id: true, status: true, activeNisn: true, user: { select: { isActive: true, passwordHash: true } } },
  });
  const sponsor = await prisma.sponsor.findFirstOrThrow({ where: { contactEmail: TEST_SPONSOR.email }, select: { id: true, status: true } });
  return { staff, school, students, sponsor };
}

test("akun uji: semua peran dibuat, aktif, dan bisa masuk dengan TEST_ACCOUNT_PASSWORD", async () => {
  const summary = await runTestAccountsSeed({ passwordHash: await hashTestPassword(PASSWORD) });
  const snap = await snapshot();
  assert.deepEqual(snap.staff.map((u) => u.role).sort(), ["SCHOOL_ADMIN", "SPONSOR", "SUPER_ADMIN"]);
  for (const user of snap.staff) {
    assert.equal(user.isActive, true, String(user.email));
    assert.equal(user.mustChangePassword, false, String(user.email));
    assert.equal(await verifyPassword(PASSWORD, user.passwordHash), true, String(user.email));
  }
  assert.equal(snap.staff.find((u) => u.role === "SCHOOL_ADMIN")?.schoolId, snap.school.id);
  assert.equal(snap.staff.find((u) => u.role === "SPONSOR")?.sponsorId, snap.sponsor.id);
  assert.equal(snap.sponsor.status, "APPROVED");
  assert.equal(snap.students.length, NISNS.length);
  for (const s of snap.students) {
    assert.equal(s.status, "ACTIVE");
    assert.ok(s.activeNisn, "NISN aktif = siswa bisa masuk dengan NISN");
    assert.equal(await verifyPassword(PASSWORD, s.user.passwordHash), true);
  }
  assert.equal(summary.school.activeStudents, NISNS.length);
});

test("akun uji idempoten: dijalankan ulang = id sama, akun nonaktif diaktifkan lagi, kata sandi di-reset", async () => {
  const first = await snapshot();
  const admin = first.staff.find((u) => u.role === "SCHOOL_ADMIN")!;
  await prisma.user.update({ where: { id: admin.id }, data: { isActive: false, mustChangePassword: true } });
  await runTestAccountsSeed({ passwordHash: await hashTestPassword("GantiLagi-2026") });
  const second = await snapshot();
  assert.deepEqual(second.staff.map((u) => u.id), first.staff.map((u) => u.id));
  assert.deepEqual(second.students.map((s) => s.id), first.students.map((s) => s.id));
  assert.equal(second.sponsor.id, first.sponsor.id);
  const reactivated = second.staff.find((u) => u.id === admin.id)!;
  assert.equal(reactivated.isActive, true);
  assert.equal(reactivated.mustChangePassword, false);
  assert.equal(await verifyPassword("GantiLagi-2026", reactivated.passwordHash), true);
});
