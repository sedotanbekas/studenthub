import assert from "node:assert/strict";
import test from "node:test";
import { accountBadge, canImpersonate, groupSummary, loginKindLabel, passwordSummary, resetRequest, shortDateTime, type AccountView } from "./account-rules";

const base: AccountView = { id: "u1", name: "Adriano", role: "STUDENT", isActive: true, adminKind: null, student: { id: "s1", nisn: "0000000001", nis: "1", status: "ACTIVE", className: "X IPA 1" }, sponsor: null };

test("accountBadge: peran yang mudah dibaca (admin utama/tambahan, siswa + kelas, sponsor)", () => {
  assert.equal(accountBadge(base), "Siswa · X IPA 1");
  assert.equal(accountBadge({ ...base, student: { ...base.student!, className: null } }), "Siswa · belum ada kelas");
  assert.equal(accountBadge({ ...base, role: "SCHOOL_ADMIN", student: null, adminKind: "PRIMARY" }), "Admin utama");
  assert.equal(accountBadge({ ...base, role: "SCHOOL_ADMIN", student: null, adminKind: "ADDITIONAL" }), "Admin tambahan (guru)");
  assert.equal(accountBadge({ ...base, role: "SPONSOR", student: null, sponsor: { companyName: "PT Maju" } }), "Sponsor · PT Maju");
  assert.equal(accountBadge({ ...base, role: "SUPER_ADMIN", student: null }), "Super admin");
});

test("loginKindLabel", () => {
  assert.equal(loginKindLabel("NISN"), "NISN");
  assert.equal(loginKindLabel("NPSN"), "NPSN sekolah");
  assert.equal(loginKindLabel("EMAIL"), "Email");
});

test("passwordSummary: bawaan menampilkan teks apa adanya; kedaluwarsa diberi tanda bahaya", () => {
  const ok = passwordSummary({ kind: "DEFAULT", plain: "studenthubid", expiresAt: "2026-10-19T03:00:00.000Z", expired: false, changedAt: null });
  assert.equal(ok.plain, "studenthubid");
  assert.equal(ok.tone, "info");
  assert.match(ok.detail, /wajib diganti/i);
  const expired = passwordSummary({ kind: "DEFAULT", plain: "studenthubid", expiresAt: "2026-10-01T03:00:00.000Z", expired: true, changedAt: null });
  assert.equal(expired.tone, "danger");
  assert.match(expired.detail, /kedaluwarsa/i);
});

test("passwordSummary: sementara acak / ditentukan admin / milik pengguna tidak pernah punya teks", () => {
  for (const kind of ["TEMPORARY", "ADMIN_SET", "OWN"] as const) {
    const summary = passwordSummary({ kind, plain: null, expiresAt: null, expired: false, changedAt: "2026-10-03T03:00:00.000Z" });
    assert.equal(summary.plain, null, kind);
    assert.ok(summary.title.length > 0, kind);
  }
  assert.match(passwordSummary({ kind: "OWN", plain: null, expiresAt: null, expired: false, changedAt: "2026-10-03T03:00:00.000Z" }).detail, new RegExp(shortDateTime("2026-10-03T03:00:00.000Z")));
  assert.equal(passwordSummary(undefined).title, "Status kata sandi tidak tersedia");
});

test("groupSummary: jumlah akun ringkas", () => {
  assert.equal(groupSummary({ schoolAdmins: 1, students: 3 }), "1 admin · 3 siswa");
  assert.equal(groupSummary({ schoolAdmins: 0, students: 0 }), "Belum ada akun");
});

test("resetRequest: siswa lewat endpoint siswa + sekolahnya sendiri; akun lain lewat endpoint platform", () => {
  const studentRow = { ...base, email: null, school: { id: "sc 1", name: "S" }, lastLoginAt: null };
  assert.deepEqual(resetRequest(studentRow), { path: "/school/students/s1/reset-password?schoolId=sc%201" });
  assert.deepEqual(resetRequest({ ...studentRow, role: "SCHOOL_ADMIN", student: null }), { path: "/platform/users/u1/reset-password", body: "{}" });
});

test("canImpersonate: semua akun aktif selain super admin", () => {
  assert.equal(canImpersonate(base), true);
  assert.equal(canImpersonate({ ...base, role: "SUPER_ADMIN" }), false);
  assert.equal(canImpersonate({ ...base, isActive: false }), false);
});
