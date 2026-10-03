import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCHOOL_CONFIG } from "@/lib/schools/rules";
import {
  REMINDER_LEAD_MAX,
  REMINDER_LEAD_MIN,
  isDefaultSchedule,
  planReminderRecipients,
  reminderExpiresAt,
  reminderKey,
  reminderSendMinute,
  reminderSlot,
  type ReminderCandidate,
  type ReminderSchedule,
} from "./reminder-rules";

const WIB: ReminderSchedule = { timezone: "WIB", checkInOpenMinute: 360, startMinute: 420, lateToleranceMinutes: 15, schoolDaysMask: 31, attendanceReminderLeadMinutes: 15 };
/** Selasa 18 Maret 2031 (mask 31 = Senin–Jumat). */
const at = (hhmmWib: string, date = "2031-03-18") => new Date(`${date}T${hhmmWib}:00+07:00`);

test("reminderSendMinute: jam masuk - lead, tidak lebih awal dari jam buka absen", () => {
  assert.equal(reminderSendMinute(WIB), 405);
  assert.equal(reminderSendMinute({ ...WIB, attendanceReminderLeadMinutes: 60 }), 360);
  assert.equal(reminderSendMinute({ ...WIB, attendanceReminderLeadMinutes: 120 }), 360, "dijepit ke jam buka");
  assert.deepEqual([REMINDER_LEAD_MIN, REMINDER_LEAD_MAX], [5, 120]);
});

test("reminderSlot: jendela [kirim, jam masuk - 1 menit); tanggal lokal; kedaluwarsa = batas hadir", () => {
  assert.equal(reminderSlot(at("06:44"), WIB), null);
  const slot = reminderSlot(at("06:45"), WIB);
  assert.equal(slot?.date, "2031-03-18");
  assert.equal(slot?.expiresAt.toISOString(), "2031-03-18T00:15:00.000Z", "07:00 + toleransi 15 = 07:15 WIB");
  assert.ok(reminderSlot(at("06:58"), WIB));
  assert.equal(reminderSlot(at("06:59"), WIB), null, "menit terakhir sebelum bel: tidak sempat terkirim");
  assert.equal(reminderSlot(at("07:00"), WIB), null);
  assert.equal(reminderSlot(at("07:30"), WIB), null);
  assert.equal(reminderSlot(at("06:50", "2031-03-22"), WIB), null, "Sabtu di luar mask 31");
});

test("reminderSlot: WIT memakai tanggal lokal (pelajaran HRIS jadwal UTC)", () => {
  const wit = { ...WIB, timezone: "WIT" as const };
  const slot = reminderSlot(new Date("2031-03-17T21:50:00Z"), wit);
  assert.equal(slot?.date, "2031-03-18", "06:50 WIT Selasa");
});

test("reminderSlot: jendela kosong (buka = masuk - 1) -> tidak pernah", () => {
  const tight = { ...WIB, checkInOpenMinute: 419 };
  for (const t of ["06:58", "06:59", "07:00"]) assert.equal(reminderSlot(at(t), tight), null, t);
});

test("reminderExpiresAt & reminderKey", () => {
  assert.equal(reminderExpiresAt("2031-03-18", WIB).toISOString(), "2031-03-18T00:15:00.000Z");
  assert.equal(reminderKey("2031-03-18"), "attendance-reminder:2031-03-18");
});

test("isDefaultSchedule: jadwal bawaan yang belum pernah diatur sekolah", () => {
  assert.equal(isDefaultSchedule(DEFAULT_SCHOOL_CONFIG), true);
  assert.equal(isDefaultSchedule({ ...DEFAULT_SCHOOL_CONFIG, startMinute: 435 }), false);
  assert.equal(isDefaultSchedule({ ...DEFAULT_SCHOOL_CONFIG, schoolDaysMask: 63 }), false);
});

const policy = { timezone: "WIB" as const, checkInCloseMinute: 600 };
const cand = (id: string, extra: Partial<ReminderCandidate> = {}): ReminderCandidate => ({ id, userId: `u-${id}`, status: "ACTIVE", activatedAt: new Date("2031-01-01T00:00:00Z"), ...extra });

test("planReminderRecipients: wajib absen, tanpa izin yang mencakup hari ini, punya perangkat; unik & urut", () => {
  const D = "2031-03-18";
  const candidates = [
    cand("c"), cand("a"), cand("a"),
    cand("inactive", { status: "INACTIVE" }),
    cand("late", { activatedAt: new Date("2031-03-18T03:30:00Z") }),
    cand("pending"), cand("approved"), cand("yesterday"), cand("offline"),
  ];
  const leaves = [
    { studentId: "pending", startDate: D, endDate: D },
    { studentId: "approved", startDate: "2031-03-17", endDate: "2031-03-19" },
    { studentId: "yesterday", startDate: "2031-03-16", endDate: "2031-03-17" },
  ];
  const reachable = new Set(["u-a", "u-c", "u-inactive", "u-late", "u-pending", "u-approved", "u-yesterday"]);
  assert.deepEqual(planReminderRecipients(D, candidates, leaves, policy, reachable), ["u-a", "u-c", "u-yesterday"]);
});
