import { test } from "node:test";
import assert from "node:assert/strict";
import { PUSH_BODY_MAX } from "@/lib/push/constants";
import { resolveCategory } from "../rules";
import { attendanceReminderEvent } from "./attendance-reminder";

test("pengingat absen: teks dengan jam masuk & batas hadir, tautan alur absen, dedup per tanggal, kedaluwarsa", () => {
  const expiresAt = new Date("2031-03-18T00:15:00Z");
  const event = attendanceReminderEvent({ date: "2031-03-18", startMinute: 420, lateToleranceMinutes: 15, expiresAt });
  assert.equal(event.type, "ATTENDANCE_REMINDER");
  assert.equal(event.title, "Kamu belum absen hari ini");
  assert.equal(event.body, "Jam masuk 07:00. Absen begitu tiba di sekolah, paling lambat 07:15 agar tercatat hadir.");
  assert.ok(Array.from(event.body).length <= PUSH_BODY_MAX);
  assert.deepEqual(event.link, { screen: "check-in", id: "2031-03-18" });
  assert.equal(event.dedupKey, "attendance-reminder:2031-03-18");
  assert.equal(event.pushExpiresAt, expiresAt);
  assert.equal(resolveCategory(event.type), "ATTENDANCE");
});
