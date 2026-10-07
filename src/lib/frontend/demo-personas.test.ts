import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_PERSONAS, demoPersona, demoPersonaForUser } from "./demo-personas";
import { demoCheckOutResult, demoTodayFor, withDemoCheckOut } from "./demo";

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
  assert.deepEqual(demoTodayFor("STUDENT_BIMA").record, {
    id: "demo-att-bima", status: "HADIR", source: "CHECKIN", checkInTimeLocal: "06:42", lateMinutes: null, lateReason: null, lateReasonEditable: false, checkOutTimeLocal: null,
  });
  assert.equal(demoTodayFor("STUDENT_BIMA").blockReason, "ALREADY_CHECKED_IN");
  assert.equal(demoTodayFor("STUDENT_CITRA").record?.status, "TERLAMBAT");
  assert.equal(demoTodayFor("STUDENT_CITRA").canCheckIn, false);
  // Citra terlambat dan belum mengisi alasan: kartu hari ini menawarkan "Isi alasan" (A1).
  assert.equal(demoTodayFor("STUDENT_CITRA").record?.lateReason, null);
  assert.equal(demoTodayFor("STUDENT_CITRA").record?.lateReasonEditable, true);
});

test("absen pulang demo: siswa yang sudah absen masuk boleh pulang mulai 14:00 WIB; yang belum masuk tidak", () => {
  const morning = new Date("2026-09-25T03:00:00.000Z"); // 10:00 WIB
  const afternoon = new Date("2026-09-25T07:05:00.000Z"); // 14:05 WIB
  assert.equal(demoTodayFor("STUDENT_BIMA", morning).canCheckOut, false);
  assert.equal(demoTodayFor("STUDENT_BIMA", morning).checkOutBlockReason, "CHECKOUT_NOT_OPEN");
  assert.equal(demoTodayFor("STUDENT_BIMA", afternoon).canCheckOut, true);
  assert.equal(demoTodayFor("STUDENT_CITRA", afternoon).canCheckOut, true);
  assert.equal(demoTodayFor("STUDENT", afternoon).canCheckOut, false);
  assert.equal(demoTodayFor("STUDENT", afternoon).checkOutBlockReason, "NOT_CHECKED_IN");
  assert.equal(demoTodayFor("STUDENT", afternoon).window.checkOutOpensAt, "14:00");
});

test("absen pulang demo tersimulasi tanpa jaringan: hasil jam WIB dan kartu hari ini menjadi sudah pulang", () => {
  const afternoon = new Date("2026-09-25T07:05:00.000Z"); // 14:05 WIB
  const result = demoCheckOutResult(afternoon, "06:42");
  assert.equal(result.attendance.checkOutTimeLocal, "14:05");
  assert.equal(result.attendance.checkInTimeLocal, "06:42");
  const today = withDemoCheckOut(demoTodayFor("STUDENT_BIMA", afternoon), "14:05");
  assert.equal(today.record?.checkOutTimeLocal, "14:05");
  assert.equal(today.canCheckOut, false);
  assert.equal(today.checkOutBlockReason, "ALREADY_CHECKED_OUT");
  assert.equal(withDemoCheckOut(demoTodayFor("STUDENT", afternoon), "14:05").record, null, "belum absen masuk: tidak berubah");
});
