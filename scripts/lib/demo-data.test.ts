import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isThemePresetKey } from "../../src/lib/schools/theme-store-rules";
import {
  checkDemoPassword,
  checkSeedDatabaseUrl,
  DEMO_ACADEMIC_YEAR,
  DEMO_KKM,
  DEMO_SCHOOLS,
  DEMO_STUDENTS_PER_SCHOOL,
  DEMO_SUPER_ADMIN,
  demoAdminEmail,
} from "./demo-data";

const regions = JSON.parse(readFileSync(path.join(process.cwd(), "prisma", "data", "regions.json"), "utf8")) as {
  provinces: Array<{ code: string }>;
  cities: Array<{ code: string; provinceCode: string }>;
};

test("checkSeedDatabaseUrl: hanya database berakhiran _staging, _dev, atau _test", () => {
  for (const name of ["studenthub_staging", "studenthub_dev", "studenthub_test"]) {
    const result = checkSeedDatabaseUrl(`mysql://u:p@127.0.0.1:3307/${name}`);
    assert.deepEqual(result, { ok: true, database: name, host: "127.0.0.1:3307" });
  }
  for (const name of ["studenthub", "studenthub_prod", "studenthub_staging_old", "staging", "studenthub_TEST"]) {
    const result = checkSeedDatabaseUrl(`mysql://u:p@127.0.0.1/${name}`);
    assert.equal(result.ok, false, name);
  }
  assert.equal(checkSeedDatabaseUrl(undefined).ok, false);
  assert.equal(checkSeedDatabaseUrl("bukan url").ok, false);
  assert.equal(checkSeedDatabaseUrl("postgres://u:p@h/x_dev").ok, false);
});

test("checkSeedDatabaseUrl: alasan penolakan tidak pernah memuat kredensial", () => {
  const result = checkSeedDatabaseUrl("mysql://rahasiaUser:rahasiaPass@db.local/studenthub");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.doesNotMatch(result.reason, /rahasia/);
    assert.match(result.reason, /studenthub/);
  }
});

test("checkDemoPassword: wajib ada, >= 8 karakter, huruf + angka", () => {
  assert.deepEqual(checkDemoPassword("Demo1234abcd"), []);
  assert.ok(checkDemoPassword(undefined).length > 0);
  assert.ok(checkDemoPassword("").length > 0);
  assert.ok(checkDemoPassword("Ab1").length > 0);
  assert.ok(checkDemoPassword("abcdefghij").length > 0);
  assert.ok(checkDemoPassword("1234567890").length > 0);
});

test("dataset: dua sekolah WIB & WIT dengan kode wilayah valid dan email admin demo", () => {
  assert.deepEqual(
    DEMO_SCHOOLS.map((s) => [s.name, s.timezone]),
    [
      ["SMP Negeri 1 Harapan Jaya (Demo)", "WIB"],
      ["SMA Demo Nusantara Timur", "WIT"],
    ],
  );
  for (const school of DEMO_SCHOOLS) {
    assert.ok(regions.provinces.some((p) => p.code === school.provinceCode), school.provinceCode);
    assert.ok(regions.cities.some((c) => c.code === school.cityCode && c.provinceCode === school.provinceCode), school.cityCode);
    assert.match(school.npsn, /^\d{8}$/);
    assert.equal(school.geofenceRadiusM, 150);
    assert.match(demoAdminEmail(school), /^admin@[a-z0-9-]+\.demo\.studenthub\.id$/);
  }
  assert.equal(DEMO_SUPER_ADMIN.email, "superadmin@demo.studenthub.id");
  assert.equal(DEMO_SCHOOLS[0]?.latitude, "-6.9175");
  assert.equal(DEMO_SCHOOLS[0]?.longitude, "107.6191");
});

test("dataset: sekolah demo pertama tema bawaan, sekolah kedua preset tema madani (kunci preset valid)", () => {
  assert.deepEqual(DEMO_SCHOOLS.map((s) => s.themePreset ?? null), [null, "madani"]);
  for (const school of DEMO_SCHOOLS) {
    if (school.themePreset) assert.ok(isThemePresetKey(school.themePreset), school.themePreset);
  }
});

test("dataset: tahun ajaran 2026/2027 dengan Ganjil aktif dan Genap", () => {
  assert.equal(DEMO_ACADEMIC_YEAR.name, "2026/2027");
  const ganjil = DEMO_ACADEMIC_YEAR.terms.find((t) => t.semester === "GANJIL");
  assert.deepEqual(ganjil, { semester: "GANJIL", startDate: "2026-07-13", endDate: "2026-12-19", active: true });
  assert.equal(DEMO_ACADEMIC_YEAR.terms.filter((t) => t.active).length, 1);
  for (const term of DEMO_ACADEMIC_YEAR.terms) {
    assert.ok(term.startDate < term.endDate);
    assert.ok(term.startDate >= DEMO_ACADEMIC_YEAR.startDate && term.endDate <= DEMO_ACADEMIC_YEAR.endDate);
  }
});

test("dataset: 3 kelas & 6 mapel KKM 75 per sekolah", () => {
  assert.deepEqual(DEMO_SCHOOLS[0]?.classes.map((c) => c.name), ["VII-A", "VII-B", "VIII-A"]);
  assert.deepEqual(DEMO_SCHOOLS[1]?.classes.map((c) => c.name), ["X-1", "X-2", "XI-1"]);
  assert.equal(DEMO_KKM, 75);
  for (const school of DEMO_SCHOOLS) {
    assert.equal(school.subjects.length, 6);
    assert.equal(new Set(school.subjects.map((s) => s.code)).size, 6);
    for (const c of school.classes) assert.ok(c.gradeLevel >= 1 && c.gradeLevel <= 12);
  }
});

test("dataset: 15 siswa per sekolah, NISN deterministik unik, biodata lengkap untuk aktivasi", () => {
  const allNisn = DEMO_SCHOOLS.flatMap((s) => s.students.map((st) => st.nisn));
  assert.equal(new Set(allNisn).size, allNisn.length);
  for (const school of DEMO_SCHOOLS) {
    assert.equal(school.students.length, DEMO_STUDENTS_PER_SCHOOL);
    assert.equal(new Set(school.students.map((st) => st.nis)).size, DEMO_STUDENTS_PER_SCHOOL);
    const classNames = new Set(school.classes.map((c) => c.name));
    for (const st of school.students) {
      assert.match(st.nisn, /^99000000\d{2}$/);
      assert.match(st.nis, /^[A-Za-z0-9./-]{1,20}$/);
      assert.ok(st.name.length >= 3 && st.name.length <= 100);
      assert.ok(st.address.length >= 10 && st.address.length <= 500);
      assert.ok(st.birthPlace.length > 0 && st.guardianName.length > 0);
      assert.match(st.guardianPhone, /^\+628[1-9]\d{6,10}$/);
      assert.match(st.birthDate, /^20(0\d|1\d)-\d{2}-\d{2}$/);
      assert.ok(classNames.has(st.className), st.className);
    }
  }
});
