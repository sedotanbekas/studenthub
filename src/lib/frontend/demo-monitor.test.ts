import { test } from "node:test";
import assert from "node:assert/strict";
import type { MapDto } from "@/lib/attendance/monitor-schemas";
import { localParts } from "@/lib/time/zone";
import { demoStudents } from "./demo";
import { demoAttendanceDetail, demoAttendanceMap, demoDailyRows, demoMonitorRows } from "./demo-monitor";

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;
function haversine(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const h = Math.sin(rad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(rad(b.longitude - a.longitude) / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(h));
}
const map = demoMonitorRows("/school/attendance/map") as MapDto;
const statusesOf = (dto: MapDto) => [...dto.points.map(p => p.status), ...dto.unlocated.map(u => u.status)];
const tally = (dto: MapDto, status: string) => statusesOf(dto).filter(s => s === status).length;

test("jalur: peta & data harian milik modul ini; lainnya -> undefined", () => {
  assert.ok(map && Array.isArray(map.points));
  assert.ok(Array.isArray(demoMonitorRows("/school/attendance/daily")));
  assert.equal(demoMonitorRows("/school/students"), undefined);
  assert.equal(demoMonitorRows("/school/attendance/map/extra"), undefined);
});

test("data harian (tab Data lengkap) sama dengan peta: status & jam per siswa cocok", () => {
  const rows = demoDailyRows(map.date);
  assert.equal(rows.length, map.points.length + map.unlocated.length);
  for (const p of map.points) {
    const row = rows.find(r => r.student.id === p.studentId);
    assert.equal(row?.attendance?.status, p.status, p.name);
    assert.equal(row?.attendance?.checkInTimeLocal, p.checkInTimeLocal, p.name);
  }
  for (const u of map.unlocated) {
    const row = rows.find(r => r.student.id === u.studentId);
    assert.equal(row?.attendance?.status ?? "BELUM_ABSEN", u.status, u.name);
  }
  const keys = rows.map(r => `${r.student.className}|${r.student.name}`);
  assert.deepEqual(keys, [...keys].sort((a, b) => a.localeCompare(b)), "urut kelas lalu nama seperti API");
});

test("peta demo: tanggal hari ini WIB, sekolah contoh, ~40 siswa dengan id unik", () => {
  assert.equal(map.date, localParts(new Date(), "WIB").ymd);
  assert.deepEqual(map.school, { latitude: -6.2335, longitude: 106.912, radiusM: 150 });
  const total = map.points.length + map.unlocated.length;
  assert.ok(total >= 38 && total <= 46, `total ${total}`);
  const studentIds = [...map.points.map(p => p.studentId), ...map.unlocated.map(u => u.studentId)];
  assert.equal(new Set(studentIds).size, studentIds.length);
  assert.equal(new Set(map.points.map(p => p.attendanceId)).size, map.points.length);
  assert.equal(map.truncated, false);
  assert.equal(map.isSchoolDay, true);
});

test("counts konsisten dengan titik + tanpa lokasi", () => {
  assert.deepEqual(map.counts, {
    hadir: tally(map, "HADIR"), terlambat: tally(map, "TERLAMBAT"), izin: tally(map, "IZIN"),
    sakit: tally(map, "SAKIT"), alpha: tally(map, "ALPHA"), notYet: tally(map, "BELUM_ABSEN"),
  });
  assert.equal(map.counts.terlambat, 6);
  assert.deepEqual([map.counts.izin, map.counts.sakit, map.counts.alpha, map.counts.notYet], [3, 2, 1, 4]);
  assert.ok(map.unlocated.every(u => (u.status === "BELUM_ABSEN") === (u.attendanceId === null)));
});

test("koordinat valid, dekat sekolah, dan distanceM sesuai jarak sebenarnya", () => {
  for (const p of map.points) {
    assert.ok(Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90, p.name);
    assert.ok(Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180, p.name);
    const actual = haversine(map.school, p);
    assert.ok(actual < 400, `${p.name} terlalu jauh`);
    assert.ok(p.distanceM !== null && Math.abs(p.distanceM - actual) <= 1, `${p.name}: ${p.distanceM} vs ${actual}`);
  }
});

test("gerombolan: >= 8 titik berkoordinat PERSIS sama & ~26 titik rapat dekat satu gedung (~40 m)", () => {
  const byCoord = new Map<string, number>();
  for (const p of map.points) byCoord.set(`${p.latitude},${p.longitude}`, (byCoord.get(`${p.latitude},${p.longitude}`) ?? 0) + 1);
  const [coord, stacked] = [...byCoord.entries()].sort((a, b) => b[1] - a[1])[0]!;
  assert.ok(stacked >= 8, `tumpukan terbesar ${stacked}`);
  const [latitude = Number.NaN, longitude = Number.NaN] = coord.split(",").map(Number);
  const building = { latitude, longitude };
  assert.ok(Math.abs(haversine(map.school, building) - 40) <= 8, "gedung ~40 m dari pusat");
  const near = map.points.filter(p => haversine(building, p) <= 25).length;
  assert.ok(near >= 24 && near <= 28, `rapat dekat gedung: ${near}`);
});

test("2 titik di luar radius ber-flag GEOFENCE_TOLERANCE & hasAnomaly", () => {
  const outside = map.points.filter(p => (p.distanceM ?? 0) > map.school.radiusM);
  assert.equal(outside.length, 2);
  assert.ok(outside.every(p => p.flags.includes("GEOFENCE_TOLERANCE") && p.hasAnomaly));
  assert.ok(map.points.every(p => [...p.flags].sort().join() === p.flags.join()), "flags terurut");
});

test("persona siswa konsisten: Bima hadir 06:42, Citra terlambat 07:31, Alya belum absen", () => {
  assert.equal(map.points.find(p => p.studentId === "s2")?.checkInTimeLocal, "06:42");
  assert.equal(map.points.find(p => p.studentId === "s3")?.status, "TERLAMBAT");
  assert.equal(map.points.find(p => p.studentId === "s3")?.checkInTimeLocal, "07:31");
  assert.equal(map.unlocated.find(u => u.studentId === "s1")?.status, "BELUM_ABSEN");
  for (const s of demoStudents.filter(d => d.status === "ACTIVE")) {
    const entry = [...map.points, ...map.unlocated].find(e => e.studentId === s.id);
    assert.ok(entry, `${String(s.name)} ada di peta demo`);
    assert.equal(entry.nis, s.nis, `NIS ${String(s.name)} sama dengan demoStudents`);
    assert.equal(entry.name, s.name);
  }
});

test("filter kelas & tanggal: counts dihitung ulang; Minggu (selain hari ini) bukan hari sekolah", () => {
  const cls = demoAttendanceMap({ className: "X IPA 1" });
  assert.ok(cls.points.length > 0);
  assert.ok([...cls.points, ...cls.unlocated].every(e => e.className === "X IPA 1"));
  assert.equal(cls.counts.hadir, tally(cls, "HADIR"));
  assert.equal(cls.counts.notYet, tally(cls, "BELUM_ABSEN"));
  const weekday = demoAttendanceMap({ date: "2026-09-23" });
  assert.equal(weekday.date, "2026-09-23");
  assert.equal(weekday.points.length, map.points.length);
  const saturday = demoAttendanceMap({ date: "2025-01-04" });
  assert.equal(saturday.isSchoolDay, true, "sekolah 6 hari: Sabtu masuk");
  const sunday = demoAttendanceMap({ date: "2025-01-05" });
  assert.equal(sunday.isSchoolDay, false);
  assert.equal(sunday.points.length + sunday.unlocated.length, 0);
  assert.equal(Object.values(sunday.counts).reduce((a, b) => a + b, 0), 0);
  const today = localParts(new Date(), "WIB").ymd;
  assert.equal(demoAttendanceMap({ date: today }).isSchoolDay, true, "hari ini selalu bisa dicoba");
});

test("detail demo: sesuai titik peta; izin tanpa koordinat; id tak dikenal -> null", () => {
  const point = map.points.find(p => p.hasAnomaly)!;
  const detail = demoAttendanceDetail(point.attendanceId)!;
  assert.equal(detail.id, point.attendanceId);
  assert.equal(detail.student.name, point.name);
  assert.equal(detail.status, point.status);
  assert.equal(detail.latitude, point.latitude);
  assert.equal(detail.distanceM, point.distanceM);
  assert.deepEqual(detail.flags.map(f => f.code), point.flags);
  assert.ok(detail.flags.every(f => f.label.length > 0 && ["LOW", "MEDIUM", "HIGH"].includes(f.severity)));
  assert.ok(detail.selfie && !detail.selfie.purged);
  const leave = map.unlocated.find(u => u.status === "IZIN")!;
  const leaveDetail = demoAttendanceDetail(leave.attendanceId!)!;
  assert.equal(leaveDetail.source, "LEAVE");
  assert.equal(leaveDetail.latitude, null);
  assert.equal(leaveDetail.selfie, null);
  assert.equal(demoAttendanceDetail("tidak-ada"), null);
});
