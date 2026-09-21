import { test } from "node:test";
import assert from "node:assert/strict";
import { maskAccountNumber, schoolSettingsChangedEvent } from "./schools";

test("nomor rekening disamarkan kecuali 4 digit terakhir", () => {
  assert.equal(maskAccountNumber("1234567890"), "****7890");
  assert.equal(maskAccountNumber("12345"), "****2345");
});

test("perubahan rekening: judul khusus + rekening baru tersamar", () => {
  const event = schoolSettingsChangedEvent({
    schoolId: "s1",
    schoolName: "SMP Uji",
    changedBy: "Super Admin",
    groups: ["BANK"],
    bank: { bankName: "BRI", bankAccountNumber: "9876543210", bankAccountHolder: "Yayasan Uji" },
  });
  assert.equal(event.type, "SCHOOL_SETTINGS_CHANGED");
  assert.equal(event.title, "Rekening SPP sekolah diubah");
  assert.match(event.body, /rekening bank SPP/);
  assert.match(event.body, /BRI \*\*\*\*3210 a\.n\. Yayasan Uji/);
  assert.doesNotMatch(event.body, /9876543210/);
  assert.deepEqual(event.link, { screen: "school-settings", id: "s1" });
});

test("rekening dihapus & geofence berubah", () => {
  const event = schoolSettingsChangedEvent({
    schoolId: "s1",
    schoolName: "SMP Uji",
    changedBy: "Super Admin",
    groups: ["LOCATION", "TIMEZONE", "BANK"],
    bank: null,
  });
  assert.match(event.body, /titik lokasi & radius geofence, zona waktu, rekening bank SPP/);
  assert.match(event.body, /Rekening SPP dihapus/);
  assert.match(event.body, /tidak diubah/);
});

test("perubahan jadwal saja memakai judul umum", () => {
  const event = schoolSettingsChangedEvent({ schoolId: "s1", schoolName: "SMP Uji", changedBy: "Admin", groups: ["SCHEDULE"] });
  assert.equal(event.title, "Pengaturan sekolah diubah");
  assert.match(event.body, /^Admin mengubah jadwal absensi untuk SMP Uji\./);
});
