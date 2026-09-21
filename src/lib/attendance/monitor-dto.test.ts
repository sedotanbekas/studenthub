import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decimalToNumber,
  fileUrl,
  flagDetails,
  rejectReasonLabel,
  timeLocal,
  toAttendanceBrief,
  toStudentBrief,
} from "./monitor-dto";

test("flagDetails memakai label & keparahan anomaly-rules; alasan penolakan berlabel Indonesia", () => {
  assert.deepEqual(flagDetails(["SHARED_DEVICE", "STALE_FIX"]), [
    { code: "SHARED_DEVICE", label: "Perangkat yang sama dipakai siswa lain hari ini", severity: "HIGH" },
    { code: "STALE_FIX", label: "Data lokasi agak lama", severity: "LOW" },
  ]);
  assert.equal(rejectReasonLabel("MOCK_LOCATION"), "Lokasi palsu (fake GPS)");
  assert.equal(rejectReasonLabel("OUTSIDE_GEOFENCE"), "Di luar area sekolah");
  assert.equal(rejectReasonLabel("KODE_BARU"), "KODE_BARU");
});

test("timeLocal: jam lokal sekolah HH:mm; null tetap null", () => {
  const instant = new Date("2026-09-21T00:16:00Z");
  assert.equal(timeLocal(instant, "WIB"), "07:16");
  assert.equal(timeLocal(instant, "WIT"), "09:16");
  assert.equal(timeLocal(null, "WIB"), null);
});

test("decimalToNumber: Decimal/string -> number, null tetap null", () => {
  assert.equal(decimalToNumber(null), null);
  assert.equal(decimalToNumber({ toString: () => "-6.9147000" }), -6.9147);
  assert.equal(decimalToNumber("107.6098"), 107.6098);
});

test("toStudentBrief & toAttendanceBrief: kelas snapshot didahulukan, flag diurai", () => {
  const student = { id: "s1", nis: "001", nisn: "0012345678", user: { name: "Budi" }, currentClass: { name: "VIII-A" } };
  assert.deepEqual(toStudentBrief(student), { id: "s1", nis: "001", nisn: "0012345678", name: "Budi", className: "VIII-A" });
  assert.equal(toStudentBrief(student, "VII-A").className, "VII-A");
  assert.equal(toStudentBrief({ ...student, currentClass: null }).className, null);
  const brief = toAttendanceBrief(
    {
      id: "a1", status: "TERLAMBAT", source: "CHECKIN", checkInAt: new Date("2026-09-21T00:20:00Z"), lateMinutes: 20,
      distanceM: 42, accuracyM: 12, hasAnomaly: true, anomalyFlags: ["STALE_FIX", "KODE_TAK_DIKENAL", 7], leaveRequestId: null, note: null,
    },
    "WIB",
  );
  assert.deepEqual(brief, {
    id: "a1", status: "TERLAMBAT", source: "CHECKIN", checkInTimeLocal: "07:20", lateMinutes: 20, distanceM: 42, accuracyM: 12,
    hasAnomaly: true, flags: ["STALE_FIX"], leaveRequestId: null, note: null,
  });
});

test("fileUrl: tautan unduhan relatif /api/v1/files/{id} (id di-encode)", () => {
  assert.equal(fileUrl("abc"), "/api/v1/files/abc");
  assert.equal(fileUrl("a/b"), "/api/v1/files/a%2Fb");
});
