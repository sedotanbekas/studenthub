import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceCorrectedNotification, formatIndonesianDate } from "./attendance-admin";

test("tanggal Indonesia lengkap dengan nama hari", () => {
  assert.equal(formatIndonesianDate("2026-09-21"), "Senin, 21 September 2026");
  assert.equal(formatIndonesianDate("2026-01-04"), "Minggu, 4 Januari 2026");
});

test("koreksi ke TERLAMBAT menyebut menit, tautan ke catatan absensi", () => {
  const event = attendanceCorrectedNotification({
    attendanceId: "att_1",
    date: "2026-09-21",
    status: "TERLAMBAT",
    lateMinutes: 16,
    reason: "Bukti CCTV gerbang",
    actorRole: "SCHOOL_ADMIN",
  });
  assert.equal(event.type, "ATTENDANCE_CORRECTED");
  assert.equal(event.title, "Absensi Anda dikoreksi");
  assert.match(event.body, /Senin, 21 September 2026/);
  assert.match(event.body, /Terlambat \(16 menit\)/);
  assert.match(event.body, /Alasan: Bukti CCTV gerbang/);
  assert.deepEqual(event.link, { screen: "attendance", id: "att_1" });
});

test("status selain TERLAMBAT memakai label enum tanpa menit", () => {
  const event = attendanceCorrectedNotification({ attendanceId: "a", date: "2026-09-22", status: "HADIR", lateMinutes: null, reason: "Salah input", actorRole: "SCHOOL_ADMIN" });
  assert.match(event.body, /menjadi Hadir oleh admin sekolah/);
  assert.doesNotMatch(event.body, /menit/);
});

test("koreksi oleh super admin tidak disebut admin sekolah", () => {
  const event = attendanceCorrectedNotification({ attendanceId: "a", date: "2026-09-22", status: "IZIN", lateMinutes: null, reason: "Koreksi pusat", actorRole: "SUPER_ADMIN" });
  assert.match(event.body, /menjadi Izin oleh super admin./);
  assert.doesNotMatch(event.body, /admin sekolah/);
});
