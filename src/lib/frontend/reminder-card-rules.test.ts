import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidLead, reachText, reminderPreview, savedText, type ReminderSettingsView } from "./reminder-card-rules";

const V: ReminderSettingsView = {
  enabled: true, leadMinutes: 15, checkInOpenMinute: 360, startMinute: 435, lateToleranceMinutes: 15, schoolDaysMask: 31, timezone: "WIB",
  defaultSchedule: false, activeStudentCount: 1284, pushReadyStudentCount: 1012,
};

test("pratinjau: jam kirim & jarak ke jam masuk; dijepit jam buka; mati; jadwal bawaan; isian salah", () => {
  assert.deepEqual(reminderPreview(V), ["Siswa yang belum absen menerima notifikasi HP pukul 07:00 — 15 menit sebelum jam masuk 07:15."]);
  assert.deepEqual(reminderPreview({ ...V, leadMinutes: 120 }), [
    "Siswa yang belum absen menerima notifikasi HP pukul 06:00 — 75 menit sebelum jam masuk 07:15.",
    "Jam buka absen 06:00, jadi pengingat dikirim saat absen dibuka.",
  ]);
  assert.deepEqual(reminderPreview({ ...V, enabled: false }), ["Mati — siswa tidak menerima pengingat absen."]);
  assert.match(reminderPreview({ ...V, defaultSchedule: true })[0]!, /jam sekolah masih bawaan/);
  assert.deepEqual(reminderPreview({ ...V, leadMinutes: 3 }), ["Isi 5–120 menit."]);
  assert.equal(isValidLead(5) && isValidLead(120) && !isValidLead(121) && !isValidLead(7.5), true);
});

test("jangkauan memakai istilah notifikasi HP & angka berpemisah", () => {
  assert.equal(reachText(V), "1.012 dari 1.284 siswa aktif bisa menerima notifikasi HP. Siswa iPhone harus menambahkan studenthub.id ke Layar Utama dan mengizinkan notifikasi.");
});

test("toast tersimpan: jendela hari ini terbuka -> segera; di luar -> jam berikutnya; mati; jadwal bawaan", () => {
  const inWindow = new Date("2031-03-18T07:05:00+07:00");
  const evening = new Date("2031-03-18T19:00:00+07:00");
  assert.equal(savedText(V, inWindow), "Tersimpan — pengingat hari ini segera dikirim.");
  assert.equal(savedText(V, evening), "Tersimpan — pengingat berikutnya pukul 07:00.");
  assert.equal(savedText({ ...V, enabled: false }, inWindow), "Tersimpan — pengingat absen dimatikan.");
  assert.match(savedText({ ...V, defaultSchedule: true }, inWindow), /setelah jam sekolah diatur/);
});
