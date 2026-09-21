import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkLeaveDays,
  earliestLeaveStart,
  findOverlappingLeave,
  latestLeaveEnd,
  leaveCoversDate,
  planLeaveMaterialization,
  requiresAttachment,
  validateLeaveRange,
  type ExistingAttendance,
} from "./leave-rules";

const TODAY = "2026-09-21";
const student = (startDate: string, endDate: string) => validateLeaveRange({ startDate, endDate, today: TODAY, actor: "STUDENT" });
const admin = (startDate: string, endDate: string) => validateLeaveRange({ startDate, endDate, today: TODAY, actor: "ADMIN" });

describe("validateLeaveRange", () => {
  test("siswa: mundur 7 hari boleh, 8 hari ditolak", () => {
    assert.equal(student("2026-09-14", "2026-09-14"), null);
    assert.equal(student("2026-09-13", "2026-09-14")?.code, "LEAVE_BACKDATE_LIMIT");
  });

  test("admin: mundur 30 hari boleh, 31 hari ditolak", () => {
    assert.equal(admin("2026-08-22", "2026-08-22"), null);
    assert.equal(admin("2026-08-21", "2026-08-22")?.code, "LEAVE_BACKDATE_LIMIT");
  });

  test("maju: selesai hari ini + 30 boleh, + 31 ditolak (siswa & admin)", () => {
    assert.equal(student("2026-10-21", "2026-10-21"), null);
    assert.equal(student("2026-10-22", "2026-10-22")?.code, "LEAVE_ADVANCE_LIMIT");
    assert.equal(admin("2026-10-20", "2026-10-22")?.code, "LEAVE_ADVANCE_LIMIT");
  });

  test("rentang 14 hari kalender boleh, 15 ditolak", () => {
    assert.equal(student("2026-09-21", "2026-10-04"), null);
    const violation = student("2026-09-21", "2026-10-05");
    assert.equal(violation?.code, "LEAVE_TOO_LONG");
    assert.match(violation?.message ?? "", /14 hari/);
  });

  test("selesai sebelum mulai ditolak; satu hari (hari ini) boleh", () => {
    assert.equal(student("2026-09-22", "2026-09-21")?.code, "INVALID_DATE_RANGE");
    assert.equal(student(TODAY, TODAY), null);
  });

  test("pesan batas menyebut tanggal paling awal / paling akhir", () => {
    assert.match(student("2026-09-01", "2026-09-02")?.message ?? "", /2026-09-14/);
    assert.match(student("2026-10-30", "2026-10-31")?.message ?? "", /2026-10-21/);
  });

  test("batas tanggal dihitung dari hari ini lokal", () => {
    assert.equal(earliestLeaveStart(TODAY, "STUDENT"), "2026-09-14");
    assert.equal(earliestLeaveStart(TODAY, "ADMIN"), "2026-08-22");
    assert.equal(latestLeaveEnd(TODAY), "2026-10-21");
    assert.equal(earliestLeaveStart("2027-01-03", "STUDENT"), "2026-12-27");
  });
});

describe("checkLeaveDays & requiresAttachment", () => {
  test("tanpa hari sekolah -> NO_SCHOOL_DAYS_IN_RANGE", () => {
    assert.equal(checkLeaveDays({ type: "IZIN", schoolDayCount: 0, hasAttachment: true })?.code, "NO_SCHOOL_DAYS_IN_RANGE");
  });

  test("SAKIT 3 hari sekolah tanpa lampiran ditolak, 2 hari boleh, dengan lampiran boleh", () => {
    assert.equal(checkLeaveDays({ type: "SAKIT", schoolDayCount: 3, hasAttachment: false })?.code, "ATTACHMENT_REQUIRED");
    assert.equal(checkLeaveDays({ type: "SAKIT", schoolDayCount: 2, hasAttachment: false }), null);
    assert.equal(checkLeaveDays({ type: "SAKIT", schoolDayCount: 5, hasAttachment: true }), null);
  });

  test("IZIN 5 hari sekolah tanpa lampiran boleh", () => {
    assert.equal(checkLeaveDays({ type: "IZIN", schoolDayCount: 5, hasAttachment: false }), null);
    assert.equal(requiresAttachment("IZIN", 14), false);
    assert.equal(requiresAttachment("SAKIT", 3), true);
    assert.equal(requiresAttachment("SAKIT", 2), false);
  });
});

describe("findOverlappingLeave", () => {
  const existing = [
    { id: "a", startDate: "2026-09-21", endDate: "2026-09-23" },
    { id: "b", startDate: "2026-10-01", endDate: "2026-10-01" },
  ];

  test("rentang bersebelahan tidak tumpang tindih", () => {
    assert.equal(findOverlappingLeave({ startDate: "2026-09-24", endDate: "2026-09-30" }, existing), null);
    assert.equal(findOverlappingLeave({ startDate: "2026-09-18", endDate: "2026-09-20" }, existing), null);
  });

  test("irisan sebagian, mencakup, dan hari yang sama tumpang tindih", () => {
    assert.equal(findOverlappingLeave({ startDate: "2026-09-23", endDate: "2026-09-25" }, existing)?.id, "a");
    assert.equal(findOverlappingLeave({ startDate: "2026-09-22", endDate: "2026-09-22" }, existing)?.id, "a");
    assert.equal(findOverlappingLeave({ startDate: "2026-09-25", endDate: "2026-10-05" }, existing)?.id, "b");
    assert.equal(findOverlappingLeave({ startDate: "2026-10-01", endDate: "2026-10-01" }, existing)?.id, "b");
  });

  test("tanpa izin lain -> null", () => {
    assert.equal(findOverlappingLeave({ startDate: "2026-09-21", endDate: "2026-09-21" }, []), null);
  });
});

describe("leaveCoversDate", () => {
  test("titik ujung inklusif", () => {
    const leave = { startDate: "2026-09-21", endDate: "2026-09-23" };
    assert.equal(leaveCoversDate(leave, "2026-09-20"), false);
    assert.equal(leaveCoversDate(leave, "2026-09-21"), true);
    assert.equal(leaveCoversDate(leave, "2026-09-23"), true);
    assert.equal(leaveCoversDate(leave, "2026-09-24"), false);
  });
});

describe("planLeaveMaterialization", () => {
  const days = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-10-02"];
  const existing: ExistingAttendance[] = [
    { id: "r-alpha", date: "2026-09-14", source: "AUTO_ALPHA" },
    { id: "r-check", date: "2026-09-15", source: "CHECKIN" },
    { id: "r-admin", date: "2026-09-16", source: "ADMIN" },
    { id: "r-leave", date: "2026-09-17", source: "LEAVE" },
    // Baris di hari non-sekolah (mis. koreksi di hari libur) tidak disentuh.
    { id: "r-weekend", date: "2026-09-19", source: "AUTO_ALPHA" },
  ];

  test("pemetaan per sumber baris: buat, konversi, lewati beralasan", () => {
    const plan = planLeaveMaterialization(days, existing);
    assert.deepEqual(plan.create, ["2026-09-18", "2026-10-02"]);
    assert.deepEqual(plan.convert, [{ id: "r-alpha", date: "2026-09-14" }]);
    assert.deepEqual(plan.skipped, [
      { date: "2026-09-15", reason: "CHECKED_IN" },
      { date: "2026-09-16", reason: "ADMIN_OVERRIDE" },
      { date: "2026-09-17", reason: "ALREADY_LEAVE" },
    ]);
  });

  test("hari mendatang tanpa baris selalu dibuat", () => {
    const plan = planLeaveMaterialization(["2026-10-05", "2026-10-06"], []);
    assert.deepEqual(plan, { create: ["2026-10-05", "2026-10-06"], convert: [], skipped: [] });
  });

  test("urutan keluaran mengikuti tanggal & tanggal ganda diabaikan", () => {
    const plan = planLeaveMaterialization(["2026-09-18", "2026-09-14", "2026-09-18"], existing);
    assert.deepEqual(plan.create, ["2026-09-18"]);
    assert.deepEqual(plan.convert, [{ id: "r-alpha", date: "2026-09-14" }]);
  });

  test("hari sebelum tanggal aktivasi siswa dilewati NOT_ENROLLED (selaras eligibilitas auto-ALPHA)", () => {
    const plan = planLeaveMaterialization(days, existing, "2026-09-16");
    assert.deepEqual(plan.create, ["2026-09-18", "2026-10-02"]);
    assert.deepEqual(plan.convert, []);
    assert.deepEqual(plan.skipped, [
      { date: "2026-09-14", reason: "NOT_ENROLLED" },
      { date: "2026-09-15", reason: "NOT_ENROLLED" },
      { date: "2026-09-16", reason: "ADMIN_OVERRIDE" },
      { date: "2026-09-17", reason: "ALREADY_LEAVE" },
    ]);
    assert.deepEqual(planLeaveMaterialization(["2026-09-18"], [], null).create, ["2026-09-18"]);
  });

  test("tanpa hari sekolah -> rencana kosong", () => {
    assert.deepEqual(planLeaveMaterialization([], existing), { create: [], convert: [], skipped: [] });
  });

  test("tidak memutasi masukan", () => {
    const input = [...days];
    const rows = existing.map((row) => ({ ...row }));
    planLeaveMaterialization(input, rows);
    assert.deepEqual(input, days);
    assert.deepEqual(rows, existing);
  });
});
