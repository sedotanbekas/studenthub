import assert from "node:assert/strict";
import test from "node:test";
import { cityInProvince } from "../../src/lib/region/rules";
import { normalizeIdPhone } from "../../src/lib/students/phone";
import { isValidNisn } from "../../src/lib/students/constants";
import { DEMO_EMAIL_DOMAIN, DEMO_SCHOOLS, demoAdminEmail } from "./demo-data";
import { TEST_DEPOK_SCHOOL, TEST_EMAIL_DOMAIN, TEST_PROVINCE_ADMIN, TEST_REGION_ADMIN, TEST_SCHOOL, TEST_SPONSOR, TEST_SUPER_ADMIN, checkTestAccountPassword, testAccountLogins } from "./test-accounts-plan";

const TEST_SCHOOLS = [TEST_SCHOOL, TEST_DEPOK_SCHOOL];

test("semua akun uji ber-email @uji.studenthub.id (mudah dikenali & dinonaktifkan), terpisah dari akun demo", () => {
  const emails = [TEST_SUPER_ADMIN.email, demoAdminEmail(TEST_SCHOOL), TEST_SPONSOR.email, demoAdminEmail(TEST_DEPOK_SCHOOL)];
  for (const email of emails) assert.ok(email.endsWith(`@${TEST_EMAIL_DOMAIN}`), email);
  assert.notEqual(TEST_EMAIL_DOMAIN, DEMO_EMAIL_DOMAIN);
  assert.equal(new Set(emails).size, emails.length);
});

test("sekolah uji tidak bertabrakan dengan sekolah demo (NPSN kunci upsert)", () => {
  for (const school of TEST_SCHOOLS) {
    assert.match(school.npsn, /^\d{8}$/);
    assert.ok(!DEMO_SCHOOLS.some((s) => s.npsn === school.npsn));
    assert.match(school.name, /uji/i, "nama sekolah menandai data uji");
  }
  assert.notEqual(TEST_SCHOOL.npsn, TEST_DEPOK_SCHOOL.npsn);
});

test("akun contoh Admin Pemda (email pilihan pemilik): Jawa Barat (provinsi) & Kota Depok (kota sekolah uji)", () => {
  assert.deepEqual([TEST_PROVINCE_ADMIN.email, TEST_PROVINCE_ADMIN.provinceCode, TEST_PROVINCE_ADMIN.cityCode], ["adminjabar@gmail.com", "32", null]);
  assert.equal(TEST_REGION_ADMIN.email, "admindepok@gmail.com");
  assert.ok(cityInProvince(TEST_REGION_ADMIN.cityCode ?? "", TEST_REGION_ADMIN.provinceCode));
  assert.deepEqual([TEST_DEPOK_SCHOOL.provinceCode, TEST_DEPOK_SCHOOL.cityCode], [TEST_REGION_ADMIN.provinceCode, TEST_REGION_ADMIN.cityCode]);
});

test("siswa uji: NISN sah & unik (di luar rentang demo), HP unik, lengkap untuk aktivasi, kelasnya ada", () => {
  const demoNisns = new Set(DEMO_SCHOOLS.flatMap((s) => s.students.map((st) => st.nisn)));
  const nisns = TEST_SCHOOLS.flatMap((school) => school.students.map((s) => s.nisn));
  assert.ok(TEST_SCHOOL.students.length >= 3, "minimal 3 siswa untuk menguji daftar & absensi");
  assert.equal(new Set(nisns).size, nisns.length);
  const phones = TEST_SCHOOLS.flatMap((school) => school.students.flatMap((s) => [s.phone, s.fatherPhone, s.motherPhone]));
  assert.equal(new Set(phones).size, phones.length, "HP unik antarsekolah uji");
  for (const school of TEST_SCHOOLS) {
    const classNames = new Set(school.classes.map((c) => c.name));
    for (const s of school.students) {
      assert.ok(isValidNisn(s.nisn), `NISN ${s.nisn}`);
      assert.ok(!demoNisns.has(s.nisn), `NISN ${s.nisn} dipakai siswa demo`);
      assert.ok(classNames.has(s.className), `kelas ${s.className}`);
      assert.ok(s.guardianName.length >= 3);
      assert.equal(normalizeIdPhone(s.guardianPhone), s.guardianPhone, "HP wali tersimpan sebagai +628…");
    }
  }
});

test("daftar login per peran: siswa login dengan NISN, lainnya dengan email", () => {
  const logins = testAccountLogins();
  assert.deepEqual(logins.map((l) => l.role), [
    "SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", ...TEST_SCHOOL.students.map(() => "STUDENT"),
    "REGION_ADMIN", "REGION_ADMIN", "SCHOOL_ADMIN", ...TEST_DEPOK_SCHOOL.students.map(() => "STUDENT"),
  ]);
  assert.equal(logins[0]?.login, TEST_SUPER_ADMIN.email);
  assert.deepEqual(logins.filter((l) => l.role === "REGION_ADMIN").map((l) => l.login), ["adminjabar@gmail.com", "admindepok@gmail.com"]);
  assert.equal(logins.at(-1)?.login, TEST_DEPOK_SCHOOL.students.at(-1)?.nisn);
});

test("kata sandi akun uji wajib dari env & memenuhi kebijakan aplikasi", () => {
  assert.deepEqual(checkTestAccountPassword(undefined), ["TEST_ACCOUNT_PASSWORD belum diisi."]);
  assert.ok(checkTestAccountPassword("pendek").length > 0);
  assert.deepEqual(checkTestAccountPassword("UjiCoba-Studenthub-2026"), []);
});
