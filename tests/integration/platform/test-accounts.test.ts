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
import { TEST_DEPOK_SCHOOL, TEST_PROVINCE_ADMIN, TEST_REGION_ADMIN, TEST_SCHOOL, TEST_SPONSOR, TEST_SUPER_ADMIN } from "../../../scripts/lib/test-accounts-plan";
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

test("akun uji Pemda: sekolah uji Kota Depok + Admin Pemda Jawa Barat & Admin Kota Depok bisa masuk", async () => {
  const summary = await runTestAccountsSeed({ passwordHash: await hashTestPassword(PASSWORD) });
  const depok = await prisma.school.findUniqueOrThrow({ where: { npsn: TEST_DEPOK_SCHOOL.npsn }, select: { id: true, provinceCode: true, cityCode: true } });
  assert.deepEqual([depok.provinceCode, depok.cityCode], ["32", "32.76"]);
  assert.equal(summary.depokSchool.activeStudents, TEST_DEPOK_SCHOOL.students.length);
  const pemda = await prisma.user.findUniqueOrThrow({ where: { email: TEST_REGION_ADMIN.email }, select: { id: true, role: true, isActive: true, mustChangePassword: true, passwordHash: true, regionProvinceCode: true, regionCityCode: true } });
  assert.deepEqual([pemda.id, pemda.role, pemda.isActive, pemda.mustChangePassword, pemda.regionProvinceCode, pemda.regionCityCode], [summary.regionAdminIds[1], "REGION_ADMIN", true, false, "32", "32.76"]);
  assert.equal(await verifyPassword(PASSWORD, pemda.passwordHash), true);
  const jabar = await prisma.user.findUniqueOrThrow({ where: { email: TEST_PROVINCE_ADMIN.email }, select: { id: true, role: true, regionProvinceCode: true, regionCityCode: true, passwordHash: true } });
  assert.deepEqual([jabar.id, jabar.role, jabar.regionProvinceCode, jabar.regionCityCode], [summary.regionAdminIds[0], "REGION_ADMIN", "32", null]);
  assert.equal(await verifyPassword(PASSWORD, jabar.passwordHash), true);
  const again = await runTestAccountsSeed({ passwordHash: await hashTestPassword(PASSWORD) });
  assert.deepEqual(again.regionAdminIds, summary.regionAdminIds, "idempoten");
});

test("akun uji Depok: email contoh yang sudah dipakai akun jenis lain tidak pernah diubah", async () => {
  const pemda = await prisma.user.findUniqueOrThrow({ where: { email: TEST_REGION_ADMIN.email }, select: { id: true } });
  await prisma.user.update({ where: { id: pemda.id }, data: { email: "pemda-sementara@uji.studenthub.id" } });
  const other = await prisma.user.create({ data: { role: "SUPER_ADMIN", name: "Pemilik Email", email: TEST_REGION_ADMIN.email, passwordHash: "x" } });
  try {
    await assert.rejects(runTestAccountsSeed({ passwordHash: await hashTestPassword(PASSWORD) }), /sudah dipakai akun berjenis SUPER_ADMIN/);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: other.id }, select: { role: true } })).role, "SUPER_ADMIN");
  } finally {
    await prisma.user.delete({ where: { id: other.id } });
    await prisma.user.update({ where: { id: pemda.id }, data: { email: TEST_REGION_ADMIN.email } });
  }
});
