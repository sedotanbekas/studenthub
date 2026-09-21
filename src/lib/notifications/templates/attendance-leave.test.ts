import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatLeaveRange,
  leaveApprovedNotification,
  leaveRejectedNotification,
  leaveSubmittedNotification,
} from "./attendance-leave";

test("formatLeaveRange: satu hari, satu bulan, lintas bulan, lintas tahun", () => {
  assert.equal(formatLeaveRange("2026-09-21", "2026-09-21"), "21 September 2026");
  assert.equal(formatLeaveRange("2026-09-21", "2026-09-23"), "21–23 September 2026");
  assert.equal(formatLeaveRange("2026-09-30", "2026-10-02"), "30 September – 2 Oktober 2026");
  assert.equal(formatLeaveRange("2026-12-30", "2027-01-02"), "30 Desember 2026 – 2 Januari 2027");
});

test("LEAVE_SUBMITTED ke admin: nama siswa, kelas, jenis, rentang, tautan", () => {
  const event = leaveSubmittedNotification({
    leaveId: "lv1", type: "SAKIT", startDate: "2026-09-21", endDate: "2026-09-23", studentName: "Budi Santoso", className: "VII-A",
  });
  assert.equal(event.type, "LEAVE_SUBMITTED");
  assert.equal(event.title, "Pengajuan sakit baru");
  assert.equal(event.body, "Budi Santoso (VII-A) mengajukan sakit 21–23 September 2026. Menunggu persetujuan.");
  assert.deepEqual(event.link, { screen: "leave-request", id: "lv1" });
  const noClass = leaveSubmittedNotification({ leaveId: "lv2", type: "IZIN", startDate: "2026-09-21", endDate: "2026-09-21", studentName: "Ani", className: null });
  assert.equal(noClass.title, "Pengajuan izin baru");
  assert.equal(noClass.body, "Ani mengajukan izin 21 September 2026. Menunggu persetujuan.");
});

test("LEAVE_APPROVED ke siswa: dengan & tanpa catatan, input admin", () => {
  const base = { leaveId: "lv1", type: "IZIN" as const, startDate: "2026-09-21", endDate: "2026-09-22" };
  const approved = leaveApprovedNotification({ ...base, note: null, enteredByAdmin: false });
  assert.equal(approved.type, "LEAVE_APPROVED");
  assert.equal(approved.title, "Izin disetujui");
  assert.equal(approved.body, "Pengajuan izin Anda untuk 21–22 September 2026 telah disetujui.");
  assert.deepEqual(approved.link, { screen: "leave-request", id: "lv1" });
  const withNote = leaveApprovedNotification({ ...base, note: "Semoga lekas pulih", enteredByAdmin: false });
  assert.equal(withNote.body, "Pengajuan izin Anda untuk 21–22 September 2026 telah disetujui. Catatan: Semoga lekas pulih");
  const byAdmin = leaveApprovedNotification({ ...base, type: "SAKIT", note: null, enteredByAdmin: true });
  assert.equal(byAdmin.title, "Sakit dicatat sekolah");
  assert.equal(byAdmin.body, "Sekolah mencatat sakit Anda untuk 21–22 September 2026.");
});

test("LEAVE_REJECTED ke siswa memuat alasan penolakan", () => {
  const event = leaveRejectedNotification({ leaveId: "lv1", type: "SAKIT", startDate: "2026-09-21", endDate: "2026-09-21", note: "Surat dokter tidak terbaca" });
  assert.equal(event.type, "LEAVE_REJECTED");
  assert.equal(event.title, "Sakit ditolak");
  assert.equal(event.body, "Pengajuan sakit Anda untuk 21 September 2026 ditolak. Alasan: Surat dokter tidak terbaca");
});
