import { test } from "node:test";
import assert from "node:assert/strict";
import type { FileKind, UserRole } from "@prisma/client";
import type { Principal } from "@/lib/auth/principal";
import { canReadFile, type FileAccessView } from "./access";

function viewer(role: UserRole, over: Partial<Principal> = {}): Principal {
  return {
    userId: `u-${role}`,
    sessionId: "s1",
    role,
    name: "Uji",
    schoolId: role === "SCHOOL_ADMIN" || role === "STUDENT" ? "school-a" : null,
    sponsorId: role === "SPONSOR" ? "sponsor-a" : null,
    studentId: role === "STUDENT" ? "student-a" : null,
    studentStatus: role === "STUDENT" ? "ACTIVE" : null,
    sponsorStatus: role === "SPONSOR" ? "APPROVED" : null,
    mustChangePassword: false,
    platform: "WEB",
    deviceId: null,
    ...over,
  };
}

function file(kind: FileKind, over: Partial<FileAccessView> = {}): FileAccessView {
  const sponsorKind = kind === "AD_BANNER" || kind === "TOPUP_PROOF";
  return {
    kind,
    schoolId: sponsorKind ? null : "school-a",
    sponsorId: sponsorKind ? "sponsor-a" : null,
    uploadedById: "uploader",
    deletedAt: null,
    ...over,
  };
}

const PURGED = new Date("2026-09-01T00:00:00Z");

test("pengunggah selalu ALLOW (GONE bila sudah dihapus)", () => {
  for (const kind of ["ATTENDANCE_SELFIE", "PAYMENT_PROOF", "LEAVE_ATTACHMENT", "AD_BANNER", "TOPUP_PROOF"] as const) {
    const me = viewer("STUDENT", { userId: "uploader" });
    assert.equal(canReadFile(me, file(kind)), "ALLOW");
    assert.equal(canReadFile(me, file(kind, { deletedAt: PURGED })), "GONE");
  }
});

test("SUPER_ADMIN membaca semua berkas", () => {
  const su = viewer("SUPER_ADMIN");
  assert.equal(canReadFile(su, file("ATTENDANCE_SELFIE", { schoolId: "school-z" })), "ALLOW");
  assert.equal(canReadFile(su, file("TOPUP_PROOF", { sponsorId: "sponsor-z" })), "ALLOW");
  assert.equal(canReadFile(su, file("ATTENDANCE_SELFIE", { deletedAt: PURGED })), "GONE");
});

test("SCHOOL_ADMIN: sekolah sendiri untuk selfie/bukti/lampiran; sekolah lain DENY", () => {
  const sca = viewer("SCHOOL_ADMIN");
  for (const kind of ["ATTENDANCE_SELFIE", "PAYMENT_PROOF", "LEAVE_ATTACHMENT"] as const) {
    assert.equal(canReadFile(sca, file(kind)), "ALLOW");
    assert.equal(canReadFile(sca, file(kind, { schoolId: "school-b" })), "DENY");
    assert.equal(canReadFile(sca, file(kind, { schoolId: null })), "DENY");
  }
  assert.equal(canReadFile(sca, file("AD_BANNER", { schoolId: "school-a" })), "DENY");
  assert.equal(canReadFile(sca, file("TOPUP_PROOF", { schoolId: "school-a" })), "DENY");
  assert.equal(canReadFile(viewer("SCHOOL_ADMIN", { schoolId: null }), file("PAYMENT_PROOF", { schoolId: null })), "DENY");
});

test("SPONSOR: hanya banner & bukti top-up milik sponsornya", () => {
  const sp = viewer("SPONSOR");
  assert.equal(canReadFile(sp, file("AD_BANNER")), "ALLOW");
  assert.equal(canReadFile(sp, file("TOPUP_PROOF")), "ALLOW");
  assert.equal(canReadFile(sp, file("AD_BANNER", { sponsorId: "sponsor-b" })), "DENY");
  assert.equal(canReadFile(sp, file("TOPUP_PROOF", { sponsorId: "sponsor-b" })), "DENY");
  assert.equal(canReadFile(sp, file("PAYMENT_PROOF", { sponsorId: "sponsor-a" })), "DENY");
  assert.equal(canReadFile(viewer("SPONSOR", { sponsorId: null }), file("AD_BANNER", { sponsorId: null })), "DENY");
});

test("siswa lain / peran lain DENY; banner privat tidak terbuka untuk semua pengguna", () => {
  const other = viewer("STUDENT", { userId: "student-lain" });
  assert.equal(canReadFile(other, file("ATTENDANCE_SELFIE")), "DENY");
  assert.equal(canReadFile(other, file("AD_BANNER")), "DENY");
  assert.equal(canReadFile(viewer("SPONSOR"), file("ATTENDANCE_SELFIE")), "DENY");
});

test("GONE tidak pernah dibocorkan ke penonton yang DENY", () => {
  assert.equal(canReadFile(viewer("STUDENT", { userId: "x" }), file("ATTENDANCE_SELFIE", { deletedAt: PURGED })), "DENY");
  assert.equal(canReadFile(viewer("SCHOOL_ADMIN", { schoolId: "school-b" }), file("ATTENDANCE_SELFIE", { deletedAt: PURGED })), "DENY");
  assert.equal(canReadFile(viewer("SCHOOL_ADMIN"), file("ATTENDANCE_SELFIE", { deletedAt: PURGED })), "GONE");
});

test("lampiran izin yang dicatat admin: siswa pemilik izin ALLOW, siswa lain DENY", () => {
  const onBehalf = file("LEAVE_ATTACHMENT", { uploadedById: "admin-a", subjectUserId: "student-user" });
  assert.equal(canReadFile(viewer("STUDENT", { userId: "student-user" }), onBehalf), "ALLOW");
  assert.equal(canReadFile(viewer("STUDENT", { userId: "student-user" }), { ...onBehalf, deletedAt: PURGED }), "GONE");
  assert.equal(canReadFile(viewer("STUDENT", { userId: "student-lain" }), onBehalf), "DENY");
  assert.equal(canReadFile(viewer("STUDENT", { userId: "student-lain" }), { ...onBehalf, subjectUserId: null }), "DENY");
});
