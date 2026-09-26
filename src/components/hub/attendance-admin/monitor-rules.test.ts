import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MONITOR_STATUSES,
  STATUS_META,
  countOf,
  filterMonitor,
  flagLabels,
  formatAccuracy,
  formatDistance,
  isOutsideRadius,
  matchesQuery,
  ringGradient,
  scrollToReveal,
  todayLocal,
  toggleStatus,
  totalCount,
  type MapPoint,
  type MonitorData,
} from "./monitor-rules";

const point = (over: Partial<MapPoint>): MapPoint => ({
  attendanceId: "a1", studentId: "s1", name: "Alya Putri", nis: "2026001", className: "X IPA 1", status: "HADIR",
  latitude: -6.1754, longitude: 106.8272, accuracyM: 12, distanceM: 30, checkInTimeLocal: "06:40", hasAnomaly: false, flags: [], ...over,
});
const data: MonitorData = {
  date: "2026-09-25", isSchoolDay: true, truncated: false,
  school: { latitude: -6.1754, longitude: 106.8272, radiusM: 150 },
  counts: { hadir: 2, terlambat: 1, izin: 1, sakit: 0, alpha: 0, notYet: 1 },
  points: [
    point({ attendanceId: "a2", name: "Bima Aditya", nis: "2026002", checkInTimeLocal: "06:55" }),
    point({ attendanceId: "a3", name: "Citra Ayu", nis: "2026003", status: "TERLAMBAT", checkInTimeLocal: "07:21" }),
    point({ attendanceId: "a1", name: "Alya Putri", nis: "2026001", checkInTimeLocal: "06:40" }),
    point({ attendanceId: "a4", name: "Tanpa Jam", nis: "2026009", checkInTimeLocal: null }),
  ],
  unlocated: [
    { studentId: "s5", name: "Elena Safira", nis: "2026005", className: "XII IPA 1", status: "IZIN", attendanceId: "a5" },
    { studentId: "s6", name: "Farhan Maulana", nis: "2026006", className: "XI IPA 1", status: "BELUM_ABSEN", attendanceId: null },
  ],
};

test("STATUS_META: enam status dengan huruf unik (bukan hanya warna) dan kunci hitungan", () => {
  assert.deepEqual([...MONITOR_STATUSES], ["HADIR", "TERLAMBAT", "IZIN", "SAKIT", "ALPHA", "BELUM_ABSEN"]);
  const letters = MONITOR_STATUSES.map(s => STATUS_META[s].letter);
  assert.equal(new Set(letters).size, letters.length);
  assert.deepEqual(letters.slice(0, 5), ["H", "T", "I", "S", "A"]);
  assert.equal(STATUS_META.ALPHA.label, "Alpa");
  assert.equal(countOf(data.counts, "BELUM_ABSEN"), 1);
  assert.equal(countOf(data.counts, "TERLAMBAT"), 1);
  assert.equal(totalCount(data.counts), 5);
});

test("toggleStatus: menambah/menghapus tanpa memutasi, urutan kanonik", () => {
  const before = ["IZIN"] as const;
  const after = toggleStatus(before, "HADIR");
  assert.deepEqual(after, ["HADIR", "IZIN"]);
  assert.deepEqual(before, ["IZIN"]);
  assert.deepEqual(toggleStatus(after, "IZIN"), ["HADIR"]);
});

test("matchesQuery: nama (tanpa beda huruf besar) atau NIS; kosong = semua", () => {
  const entry = { name: "Alya Putri Ramadhani", nis: "2026001" };
  assert.equal(matchesQuery(entry, ""), true);
  assert.equal(matchesQuery(entry, "  putri "), true);
  assert.equal(matchesQuery(entry, "026001"), true);
  assert.equal(matchesQuery(entry, "bima"), false);
});

test("filterMonitor: urut jam masuk (tanpa jam di akhir), filter status & cari berlaku ke titik dan tanpa lokasi", () => {
  const all = filterMonitor(data, { statuses: [], query: "" });
  assert.deepEqual(all.points.map(p => p.attendanceId), ["a1", "a2", "a3", "a4"]);
  assert.equal(all.unlocated.length, 2);
  const late = filterMonitor(data, { statuses: ["TERLAMBAT", "BELUM_ABSEN"], query: "" });
  assert.deepEqual(late.points.map(p => p.attendanceId), ["a3"]);
  assert.deepEqual(late.unlocated.map(u => u.studentId), ["s6"]);
  const search = filterMonitor(data, { statuses: [], query: "elena" });
  assert.equal(search.points.length, 0);
  assert.deepEqual(search.unlocated.map(u => u.studentId), ["s5"]);
  assert.equal(data.points[0]?.attendanceId, "a2", "data asli tidak diurutkan ulang");
});

test("isOutsideRadius & formatDistance/formatAccuracy", () => {
  assert.equal(isOutsideRadius(point({ distanceM: 151 }), 150), true);
  assert.equal(isOutsideRadius(point({ distanceM: 150 }), 150), false);
  assert.equal(isOutsideRadius(point({ distanceM: null }), 150), false);
  assert.equal(formatDistance(38), "38 m");
  assert.equal(formatDistance(1250), "1,3 km");
  assert.equal(formatDistance(null), "—");
  assert.equal(formatAccuracy(12), "±12 m");
  assert.equal(formatAccuracy(null), "—");
});

test("flagLabels: kode anomali -> label singkat berbahasa Indonesia", () => {
  assert.deepEqual(flagLabels(["GEOFENCE_TOLERANCE", "SHARED_DEVICE"]), ["Di luar radius (toleransi GPS)", "HP dipakai siswa lain"]);
  assert.deepEqual(flagLabels([]), []);
});

test("ringGradient: cincin komposisi status memakai variabel warna status", () => {
  assert.equal(ringGradient(["HADIR", "HADIR", "HADIR", "TERLAMBAT"]), "conic-gradient(var(--att-hadir) 0% 75%, var(--att-terlambat) 75% 100%)");
  assert.equal(ringGradient([]), "conic-gradient(var(--att-belum) 0% 100%)");
});

test("todayLocal: tanggal lokal sekolah (WIB/WITA/WIT), zona tak dikenal -> WIB", () => {
  const instant = new Date("2026-09-25T17:30:00.000Z");
  assert.equal(todayLocal(instant, "WIB"), "2026-09-26");
  assert.equal(todayLocal(instant, "WIT"), "2026-09-26");
  assert.equal(todayLocal(new Date("2026-09-25T16:30:00.000Z"), "WIB"), "2026-09-25");
  assert.equal(todayLocal(new Date("2026-09-25T16:30:00.000Z"), "Asia/Jakarta"), "2026-09-25");
});

test("scrollToReveal: baris di bawah label sticky ikut digulir; yang sudah terlihat tidak digeser", () => {
  const view = { scrollTop: 100, height: 300 };
  const margin = { top: 44, bottom: 8 };
  assert.equal(scrollToReveal({ top: 160, bottom: 220 }, view, margin), null, "sudah terlihat di bawah label");
  assert.equal(scrollToReveal({ top: 110, bottom: 170 }, view, margin), 66, "tertutup label sticky -> naik sampai lepas dari label");
  assert.equal(scrollToReveal({ top: 380, bottom: 440 }, view, margin), 148, "di bawah tampilan -> turun secukupnya");
  assert.equal(scrollToReveal({ top: 20, bottom: 80 }, { scrollTop: 60, height: 300 }, margin), 0, "tidak pernah negatif");
  assert.equal(scrollToReveal({ top: 500, bottom: 900 }, view, margin), 456, "baris lebih tinggi dari tampilan -> tepi atasnya yang ditampilkan");
});
