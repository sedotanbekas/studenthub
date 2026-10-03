import { test } from "node:test";
import assert from "node:assert/strict";
import { LEAVE_CTA_HINT, LEAVE_EXPIRED_NOTE, notificationCta, searchDate } from "./notification-cta";

const TODAY = "2031-03-25";
const alpha = (id: string, screen = "attendance-alpha") => ({ type: "ATTENDANCE_ALPHA", data: { screen, id } });

test("Alpa: tombol ajukan izin/sakit selama tanggal masih dalam batas mundur siswa (tepat hari ini - 7 masih boleh)", () => {
  assert.deepEqual(notificationCta(alpha("2031-03-24"), TODAY), { kind: "link", label: "Ajukan izin/sakit", href: "/hub/my-leave?ajukan=2031-03-24", hint: LEAVE_CTA_HINT });
  assert.deepEqual(notificationCta(alpha("2031-03-18"), TODAY), { kind: "link", label: "Ajukan izin/sakit", href: "/hub/my-leave?ajukan=2031-03-18", hint: LEAVE_CTA_HINT });
});

test("Alpa lewat batas: catatan, bukan tombol mati", () => {
  assert.deepEqual(notificationCta(alpha("2031-03-17"), TODAY), { kind: "note", text: LEAVE_EXPIRED_NOTE });
  assert.match(LEAVE_EXPIRED_NOTE, /7 hari/);
});

test("Alpa dengan pengajuan tertunda -> Lihat pengajuan; rekap admin -> Buka kehadiran bertanggal", () => {
  assert.deepEqual(notificationCta(alpha("lv_1", "leave-request"), TODAY), { kind: "link", label: "Lihat pengajuan", href: "/hub/my-leave" });
  assert.deepEqual(notificationCta({ type: "ATTENDANCE_DAY_SUMMARY", data: { screen: "attendance-day", id: "2031-03-24" } }, TODAY), { kind: "link", label: "Buka kehadiran", href: "/hub/attendance?tanggal=2031-03-24" });
});

test("tipe lain, data rusak, atau tanggal tidak valid -> tanpa CTA", () => {
  assert.equal(notificationCta({ type: "LEAVE_APPROVED", data: { screen: "leave-request", id: "lv_1" } }, TODAY), null);
  assert.equal(notificationCta({ type: "ATTENDANCE_ALPHA", data: null }, TODAY), null);
  assert.equal(notificationCta({ type: "ATTENDANCE_ALPHA", data: "x" }, TODAY), null);
  assert.equal(notificationCta({ type: "ATTENDANCE_ALPHA", data: { screen: "attendance-alpha", id: 5 } }, TODAY), null);
  assert.equal(notificationCta(alpha("2031-02-30"), TODAY), null);
  assert.equal(notificationCta({ type: "ATTENDANCE_DAY_SUMMARY", data: { screen: "attendance-day", id: "kemarin" } }, TODAY), null);
  assert.equal(notificationCta({ type: "ATTENDANCE_DAY_SUMMARY", data: { screen: "invoice", id: "2031-03-24" } }, TODAY), null);
  assert.equal(notificationCta({}, TODAY), null);
});

test("searchDate: hanya tanggal kalender yang sah", () => {
  assert.equal(searchDate("?ajukan=2031-03-18", "ajukan"), "2031-03-18");
  assert.equal(searchDate("?tanggal=2031-03-18&x=1", "tanggal"), "2031-03-18");
  assert.equal(searchDate("?ajukan=2031-02-30", "ajukan"), null);
  assert.equal(searchDate("?ajukan=besok", "ajukan"), null);
  assert.equal(searchDate("?lain=2031-03-18", "ajukan"), null);
  assert.equal(searchDate("", "ajukan"), null);
});
