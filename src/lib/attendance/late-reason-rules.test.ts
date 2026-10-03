import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LATE_REASON_CATEGORIES,
  LATE_REASON_LABELS,
  countLateReasons,
  isSameLateReason,
  lateReasonAdminView,
  lateReasonBlock,
  lateReasonBodyOf,
  lateReasonClock,
  lateReasonDraftState,
  lateReasonNextStep,
  lateReasonNoteProblem,
  lateReasonSavedMessage,
  lateReasonShort,
  normalizeLateReasonNote,
  toLateReasonDto,
  type LateReasonTarget,
} from "./late-reason-rules";

const TODAY = "2031-03-18";

test("kode kategori tetap 6 dan berurutan (hanya boleh ditambah di ujung)", () => {
  assert.deepEqual([...LATE_REASON_CATEGORIES], ["TRANSPORT", "WEATHER", "OVERSLEPT", "FAMILY", "HEALTH", "OTHER"]);
  assert.deepEqual(Object.keys(LATE_REASON_LABELS), [...LATE_REASON_CATEGORIES]);
  assert.equal(LATE_REASON_LABELS.OTHER, "Lainnya");
});

test("keterangan dinormalkan: baris baru & karakter kontrol jadi satu spasi, karakter format dibuang, kosong -> null", () => {
  assert.equal(normalizeLateReasonNote("  Hujan\n\tderas \u0000 sekali  "), "Hujan deras sekali");
  assert.equal(normalizeLateReasonNote("ban\u202Ebocor\u200B"), "banbocor");
  assert.equal(normalizeLateReasonNote("   \n "), null);
  assert.equal(normalizeLateReasonNote(""), null);
  assert.equal(normalizeLateReasonNote(null), null);
  assert.equal(normalizeLateReasonNote(undefined), null);
});

test("lateReasonNoteProblem: Lainnya wajib >= 5 karakter; maks 200 karakter untuk semua kategori", () => {
  assert.match(lateReasonNoteProblem("OTHER", null) ?? "", /minimal 5 karakter/);
  assert.match(lateReasonNoteProblem("OTHER", "abcd") ?? "", /minimal 5 karakter/);
  assert.equal(lateReasonNoteProblem("OTHER", "abcde"), null);
  assert.equal(lateReasonNoteProblem("TRANSPORT", null), null);
  assert.match(lateReasonNoteProblem("TRANSPORT", "x".repeat(201)) ?? "", /maksimal 200/);
  assert.match(lateReasonNoteProblem("OTHER", "x".repeat(201)) ?? "", /maksimal 200/);
  assert.equal(lateReasonNoteProblem("WEATHER", "x".repeat(200)), null);
  // Emoji dihitung satu karakter (sama dengan CHAR_LENGTH MariaDB utf8mb4): 3 emoji kurang, 5 emoji cukup.
  assert.match(lateReasonNoteProblem("OTHER", "🙏🙏🙏") ?? "", /minimal/);
  assert.equal(lateReasonNoteProblem("OTHER", "🚲🚲🚲🚲🚲"), null);
  assert.equal(lateReasonNoteProblem("OTHER", "🚲".repeat(200)), null);
});

const row = (overrides: Partial<LateReasonTarget> = {}): LateReasonTarget => ({ status: "TERLAMBAT", source: "CHECKIN", date: TODAY, ...overrides });
const OPEN = { today: TODAY, dayClosed: false };

test("lateReasonClock: hari ditutup tepat pada dayEndMinute", () => {
  assert.deepEqual(lateReasonClock({ ymd: TODAY, minuteOfDay: 899 }, 900), OPEN);
  assert.deepEqual(lateReasonClock({ ymd: TODAY, minuteOfDay: 900 }, 900), { today: TODAY, dayClosed: true });
});

test("lateReasonBlock: tanpa baris / bukan hari ini -> NO_RECORD; hari ditutup; dicatat ulang admin -> LOCKED; bukan terlambat -> NOT_LATE", () => {
  assert.equal(lateReasonBlock(null, OPEN), "NO_RECORD");
  assert.equal(lateReasonBlock(row({ date: "2031-03-17" }), OPEN), "NO_RECORD");
  assert.equal(lateReasonBlock(row(), { today: TODAY, dayClosed: true }), "DAY_CLOSED");
  assert.equal(lateReasonBlock(row({ status: "HADIR" }), OPEN), "NOT_LATE");
  assert.equal(lateReasonBlock(row({ status: "IZIN", source: "LEAVE" }), OPEN), "NOT_LATE");
  assert.equal(lateReasonBlock(row({ status: "HADIR", source: "ADMIN" }), OPEN), "LOCKED");
  assert.equal(lateReasonBlock(row({ status: "ALPHA", source: "ADMIN" }), OPEN), "LOCKED", "Tidak valid (B1) juga dikunci");
  assert.equal(lateReasonBlock(row({ source: "ADMIN" }), OPEN), "LOCKED");
  assert.equal(lateReasonBlock(row(), OPEN), null);
});

test("isSameLateReason membandingkan kategori & keterangan", () => {
  assert.equal(isSameLateReason(null, { category: "TRANSPORT", note: null }), false);
  assert.equal(isSameLateReason({ category: "TRANSPORT", note: null }, { category: "TRANSPORT", note: null }), true);
  assert.equal(isSameLateReason({ category: "TRANSPORT", note: null }, { category: "WEATHER", note: null }), false);
  assert.equal(isSameLateReason({ category: "OTHER", note: "Ban bocor" }, { category: "OTHER", note: "Ban kempes" }), false);
});

test("toLateReasonDto: kategori kosong -> null; jam lokal WIB & WIT", () => {
  assert.equal(toLateReasonDto({ lateReasonCategory: null, lateReasonNote: null, lateReasonAt: null }, "WIB"), null);
  const at = new Date("2031-03-18T00:35:00.000Z");
  assert.deepEqual(toLateReasonDto({ lateReasonCategory: "WEATHER", lateReasonNote: "Hujan", lateReasonAt: at }, "WIB"), {
    category: "WEATHER",
    note: "Hujan",
    timeLocal: "07:35",
    updatedAt: "2031-03-18T00:35:00.000Z",
  });
  assert.equal(toLateReasonDto({ lateReasonCategory: "WEATHER", lateReasonNote: null, lateReasonAt: at }, "WIT")?.timeLocal, "09:35");
});

test("lateReasonSavedMessage", () => {
  assert.equal(lateReasonSavedMessage(false), "Alasan tersimpan. Admin sekolah bisa membacanya.");
  assert.equal(lateReasonSavedMessage(true), "Alasan ini sudah tersimpan.");
});

test("countLateReasons: kategori tanpa baris = 0; belum diisi hanya check-in sendiri; total = diisi + belum", () => {
  const result = countLateReasons([
    { category: "WEATHER", source: "CHECKIN", count: 2 },
    { category: "WEATHER", source: "ADMIN", count: 1 },
    { category: null, source: "CHECKIN", count: 2 },
    { category: null, source: "ADMIN", count: 5 },
    { category: "TRANSPORT", source: "CHECKIN", count: 1 },
  ]);
  assert.equal(result.total, 6);
  assert.equal(result.filled, 4);
  assert.equal(result.unfilled, 2, "TERLAMBAT yang dicatat admin tanpa alasan tidak dihitung");
  assert.deepEqual(result.categories.map((c) => c.category), [...LATE_REASON_CATEGORIES]);
  assert.deepEqual(result.categories.map((c) => c.count), [1, 3, 0, 0, 0, 0]);
  assert.deepEqual(countLateReasons([]), { total: 0, filled: 0, unfilled: 0, categories: LATE_REASON_CATEGORIES.map((category) => ({ category, count: 0 })) });
});

test("draf alasan: kosong, siap, belum lengkap", () => {
  assert.equal(lateReasonDraftState({ category: null, note: "" }), "EMPTY");
  assert.equal(lateReasonDraftState({ category: null, note: "  " }), "EMPTY");
  assert.equal(lateReasonDraftState({ category: null, note: "Hujan" }), "INCOMPLETE");
  assert.equal(lateReasonDraftState({ category: "WEATHER", note: "" }), "READY");
  assert.equal(lateReasonDraftState({ category: "OTHER", note: "abc" }), "INCOMPLETE");
  assert.equal(lateReasonDraftState({ category: "OTHER", note: "Ban bocor" }), "READY");
  assert.deepEqual(lateReasonBodyOf({ category: "OTHER", note: " Ban\nbocor " }), { category: "OTHER", note: "Ban bocor" });
  assert.deepEqual(lateReasonBodyOf({ category: "WEATHER", note: "" }), { category: "WEATHER", note: null });
  assert.equal(lateReasonBodyOf({ category: "OTHER", note: "" }), null);
});

test("lateReasonNextStep: setiap cabang", () => {
  const stored = { category: "WEATHER" as const, note: null, timeLocal: "07:35", updatedAt: "2031-03-18T00:35:00.000Z" };
  const ready = { category: "WEATHER" as const, note: "" };
  const empty = { category: null, note: "" };
  assert.equal(lateReasonNextStep({ status: "HADIR", lateReason: null, lateReasonEditable: false }, ready), "NONE");
  assert.equal(lateReasonNextStep({ status: "TERLAMBAT", lateReason: stored, lateReasonEditable: true }, ready), "SHOW_SAVED");
  assert.equal(lateReasonNextStep({ status: "TERLAMBAT", lateReason: null, lateReasonEditable: false }, ready), "NONE");
  assert.equal(lateReasonNextStep({ status: "TERLAMBAT", lateReason: null, lateReasonEditable: true }, ready), "AUTO_SUBMIT");
  assert.equal(lateReasonNextStep({ status: "TERLAMBAT", lateReason: null, lateReasonEditable: true }, empty), "ASK");
});

test("lateReasonAdminView: terisi, sebelum dikoreksi, belum diisi, tanpa tampilan", () => {
  const reason = { category: "OTHER" as const, note: "Ban sepeda bocor", timeLocal: "07:40", updatedAt: "2031-03-18T00:40:00.000Z" };
  assert.deepEqual(lateReasonAdminView({ status: "TERLAMBAT", source: "CHECKIN", lateReason: reason }), {
    title: "Alasan terlambat",
    text: "Lainnya “Ban sepeda bocor” · diisi pukul 07:40",
  });
  assert.deepEqual(lateReasonAdminView({ status: "HADIR", source: "ADMIN", lateReason: { ...reason, category: "WEATHER", note: null } }), {
    title: "Alasan terlambat (sebelum dikoreksi)",
    text: "Hujan / cuaca · diisi pukul 07:40",
  });
  assert.deepEqual(lateReasonAdminView({ status: "TERLAMBAT", source: "CHECKIN", lateReason: null }), { title: "Alasan terlambat", text: "Belum diisi siswa." });
  assert.equal(lateReasonAdminView({ status: "TERLAMBAT", source: "ADMIN", lateReason: null }), null);
  assert.equal(lateReasonAdminView({ status: "HADIR", source: "CHECKIN", lateReason: null }), null);
});

test("lateReasonShort", () => {
  assert.equal(lateReasonShort({ category: "FAMILY" }), "Keperluan keluarga");
  assert.equal(lateReasonShort(null), "");
});
