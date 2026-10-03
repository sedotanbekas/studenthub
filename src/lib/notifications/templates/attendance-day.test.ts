import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCategory, SCHOOL_ADMIN_BROADCAST_TYPES } from "../rules";
import {
  ALPHA_HOLD_LINE,
  attendanceAlphaNotification,
  attendanceAlphaPendingNotification,
  attendanceDaySummaryNotification,
} from "./attendance-day";

const counts = { alpha: 8, late: 24, izin: 18, sakit: 12, pendingAnomalies: 3 };

test("Alpa: judul bertanggal, tenggat izin, tautan ke tanggal, kunci dedup per tanggal", () => {
  const event = attendanceAlphaNotification({ date: "2031-03-18" });
  assert.equal(event.type, "ATTENDANCE_ALPHA");
  assert.equal(event.title, "Alpa pada Selasa, 18 Maret");
  assert.equal(event.body, "Kamu tercatat Alpa pada Selasa, 18 Maret 2031. Bila berhalangan, ajukan izin/sakit paling lambat Selasa, 25 Maret 2031.");
  assert.deepEqual(event.link, { screen: "attendance-alpha", id: "2031-03-18" });
  assert.equal(event.dedupKey, "attendance-alpha:2031-03-18");
  assert.equal(resolveCategory(event.type), "ATTENDANCE");
});

test("Alpa dengan pengajuan tertunda: sebab & akibat, tautan ke pengajuan, kunci dedup sama", () => {
  const sick = attendanceAlphaPendingNotification({ date: "2031-03-18", leaveId: "lv_1", type: "SAKIT" });
  assert.equal(sick.type, "ATTENDANCE_ALPHA");
  assert.equal(sick.title, "Alpa pada Selasa, 18 Maret");
  assert.equal(sick.body, "Kamu tercatat Alpa pada Selasa, 18 Maret 2031 karena pengajuan sakit kamu belum disetujui. Status berubah otomatis bila disetujui.");
  assert.deepEqual(sick.link, { screen: "leave-request", id: "lv_1" });
  assert.equal(sick.dedupKey, "attendance-alpha:2031-03-18");
  const permit = attendanceAlphaPendingNotification({ date: "2031-03-18", leaveId: "lv_2", type: "IZIN" });
  assert.match(permit.body, /pengajuan izin kamu belum disetujui/);
});

test("rekap harian admin: angka, kalimat perlu ditinjau hanya bila > 0, tautan & dedup per tanggal", () => {
  const event = attendanceDaySummaryNotification({ date: "2031-03-18", counts, alphaHeld: false });
  assert.equal(event.type, "ATTENDANCE_DAY_SUMMARY");
  assert.ok((SCHOOL_ADMIN_BROADCAST_TYPES as readonly string[]).includes(event.type));
  assert.equal(event.title, "Rekap kehadiran Selasa, 18 Maret 2031");
  assert.equal(event.body, "Alpa 8 · Terlambat 24 · Izin 18 · Sakit 12. 3 perlu ditinjau.");
  assert.deepEqual(event.link, { screen: "attendance-day", id: "2031-03-18" });
  assert.equal(event.dedupKey, "attendance-summary:2031-03-18");
  const calm = attendanceDaySummaryNotification({ date: "2031-03-18", counts: { ...counts, pendingAnomalies: 0 }, alphaHeld: false });
  assert.equal(calm.body, "Alpa 8 · Terlambat 24 · Izin 18 · Sakit 12.");
});

test("rekap harian dengan Alpa ditahan menyebut sebab dan tindakannya", () => {
  const event = attendanceDaySummaryNotification({ date: "2031-03-18", counts: { ...counts, late: 0, pendingAnomalies: 0 }, alphaHeld: true });
  assert.equal(event.body, `Alpa 8 · Terlambat 0 · Izin 18 · Sakit 12. ${ALPHA_HOLD_LINE}`);
  assert.match(ALPHA_HOLD_LINE, /ditahan/);
  assert.match(ALPHA_HOLD_LINE, /Kalender/);
});
