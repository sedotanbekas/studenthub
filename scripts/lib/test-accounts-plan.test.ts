import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIdPhone } from "../../src/lib/students/phone";
import { isValidNisn } from "../../src/lib/students/constants";
import { DEMO_EMAIL_DOMAIN, DEMO_SCHOOLS, demoAdminEmail } from "./demo-data";
import { TEST_EMAIL_DOMAIN, TEST_SCHOOL, TEST_SPONSOR, TEST_SUPER_ADMIN, checkTestAccountPassword, testAccountLogins } from "./test-accounts-plan";

test("semua akun uji ber-email @uji.studenthub.id (mudah dikenali & dinonaktifkan), terpisah dari akun demo", () => {
  const emails = [TEST_SUPER_ADMIN.email, demoAdminEmail(TEST_SCHOOL), TEST_SPONSOR.email];
  for (const email of emails) assert.ok(email.endsWith(`@${TEST_EMAIL_DOMAIN}`), email);
  assert.notEqual(TEST_EMAIL_DOMAIN, DEMO_EMAIL_DOMAIN);
  assert.equal(new Set(emails).size, emails.length);
});

test("sekolah uji tidak bertabrakan dengan sekolah demo (NPSN kunci upsert)", () => {
  assert.match(TEST_SCHOOL.npsn, /^\d{8}$/);
  assert.ok(!DEMO_SCHOOLS.some((s) => s.npsn === TEST_SCHOOL.npsn));
  assert.match(TEST_SCHOOL.name, /uji/i, "nama sekolah menandai data uji");
});

test("siswa uji: NISN sah & unik (di luar rentang demo), lengkap untuk aktivasi, kelasnya ada", () => {
  const demoNisns = new Set(DEMO_SCHOOLS.flatMap((s) => s.students.map((st) => st.nisn)));
  const nisns = TEST_SCHOOL.students.map((s) => s.nisn);
  assert.ok(nisns.length >= 3, "minimal 3 siswa untuk menguji daftar & absensi");
  assert.equal(new Set(nisns).size, nisns.length);
  const classNames = new Set(TEST_SCHOOL.classes.map((c) => c.name));
  for (const s of TEST_SCHOOL.students) {
    assert.ok(isValidNisn(s.nisn), `NISN ${s.nisn}`);
    assert.ok(!demoNisns.has(s.nisn), `NISN ${s.nisn} dipakai siswa demo`);
    assert.ok(classNames.has(s.className), `kelas ${s.className}`);
    assert.ok(s.guardianName.length >= 3);
    assert.equal(normalizeIdPhone(s.guardianPhone), s.guardianPhone, "HP wali tersimpan sebagai +628…");
  }
});

test("daftar login per peran: siswa login dengan NISN, lainnya dengan email", () => {
  const logins = testAccountLogins();
  assert.deepEqual(logins.map((l) => l.role), ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", ...TEST_SCHOOL.students.map(() => "STUDENT")]);
  assert.equal(logins[0]?.login, TEST_SUPER_ADMIN.email);
  assert.equal(logins.at(-1)?.login, TEST_SCHOOL.students.at(-1)?.nisn);
});

test("kata sandi akun uji wajib dari env & memenuhi kebijakan aplikasi", () => {
  assert.deepEqual(checkTestAccountPassword(undefined), ["TEST_ACCOUNT_PASSWORD belum diisi."]);
  assert.ok(checkTestAccountPassword("pendek").length > 0);
  assert.deepEqual(checkTestAccountPassword("UjiCoba-Studenthub-2026"), []);
});
