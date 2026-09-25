import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_PERSONAS, demoPersona, demoPersonaForUser, demoTodayFor } from "./demo-personas";

test("persona demo: admin sekolah, tiga siswa, sponsor, super admin — kunci unik", () => {
  const roles = DEMO_PERSONAS.map(p => p.identity.user.role);
  assert.deepEqual(roles, ["SCHOOL_ADMIN", "STUDENT", "STUDENT", "STUDENT", "SPONSOR", "SUPER_ADMIN"]);
  assert.equal(new Set(DEMO_PERSONAS.map(p => p.key)).size, DEMO_PERSONAS.length);
});

test("identitas persona sesuai peran: sekolah untuk admin/siswa, perusahaan untuk sponsor", () => {
  assert.equal(demoPersona("SPONSOR").identity.sponsor?.companyName, "PT Cahaya Ilmu Nusantara");
  assert.equal(demoPersona("SPONSOR").identity.school, null);
  assert.equal(demoPersona("SUPER_ADMIN").identity.school, null);
  assert.equal(demoPersona("STUDENT").identity.school?.name, "SMA Cendekia Nusantara");
});

test("kunci tak dikenal / kosong jatuh ke admin sekolah; persona dapat ditemukan dari id user", () => {
  assert.equal(demoPersona(null).key, "SCHOOL_ADMIN");
  assert.equal(demoPersona("TIDAK_ADA").key, "SCHOOL_ADMIN");
  const bima = demoPersona("STUDENT_BIMA");
  assert.equal(demoPersonaForUser(bima.identity.user.id)?.key, "STUDENT_BIMA");
  assert.equal(demoPersonaForUser("user-asli"), undefined);
});

test("status absen hari ini berbeda per siswa: belum absen, hadir, terlambat", () => {
  assert.equal(demoTodayFor("STUDENT").canCheckIn, true);
  assert.equal(demoTodayFor("STUDENT").record, null);
  assert.deepEqual(demoTodayFor("STUDENT_BIMA").record, { id: "demo-att-bima", status: "HADIR", source: "CHECKIN", checkInTimeLocal: "06:42", lateMinutes: null });
  assert.equal(demoTodayFor("STUDENT_BIMA").blockReason, "ALREADY_CHECKED_IN");
  assert.equal(demoTodayFor("STUDENT_CITRA").record?.status, "TERLAMBAT");
  assert.equal(demoTodayFor("STUDENT_CITRA").canCheckIn, false);
});
