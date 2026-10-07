import type { AnomalyCode, AnomalySeverity } from "@/lib/attendance/anomaly-rules";
import { FLAGS_CHANGED, normalizeReviewNote, planAnomalyReview, reviewNoteProblem, sameFlagSet, type AnomalyReviewFilter } from "@/lib/attendance/anomaly-review-rules";
import type { AnomalyReviewResultDto } from "@/lib/attendance/anomaly-review-schemas";
import { countLateReasons, type LateReasonCode, type LateReasonDto } from "@/lib/attendance/late-reason-rules";
import type { LateReasonCountsDto } from "@/lib/attendance/late-reason-schemas";
import type { AnomalyRowDto, DailyRowDto, MapDto, RecordDetailDto } from "@/lib/attendance/monitor-schemas";
import { formatMinute, instantAtLocal, localParts } from "@/lib/time/zone";
import { ApiError } from "./api";
import { reviewOf, saveDemoReview, withReview, type DemoReview } from "./demo-reviews";

/**
 * Data contoh monitoring absensi admin sekolah (peta check-in) untuk mode demo. Bentuk persis DTO
 * /school/attendance/map & /school/attendance/{id}; `undefined` bila jalur bukan milik modul ini.
 * Sebagian besar siswa check-in dari satu gedung (8 di antaranya berkoordinat persis sama — umum
 * saat banyak HP memakai lokasi Wi-Fi kelas yang sama) agar pengelompokan & sebaran pin terlihat.
 */

type MapPoint = MapDto["points"][number];
type Unlocated = MapDto["unlocated"][number];
type LeaveStatus = "IZIN" | "SAKIT" | "ALPHA" | "BELUM_ABSEN";

/** Titik sekolah fiktif di area permukiman (bukan landmark) agar peta contoh terlihat wajar. */
const SCHOOL = { latitude: -6.2335, longitude: 106.912, radiusM: 150 } as const;
const EARTH_M = 6_371_000;
const LATE_AFTER = "07:15";
const DAY_START_MINUTE = 7 * 60;
/** Gedung kelas X (~40 m timur laut pusat sekolah), dalam meter [utara, timur]. */
const BUILDING: readonly [number, number] = [28, 28];

const X1 = "X IPA 1", X2 = "X IPA 2", XI1 = "XI IPA 1", XI2 = "XI IPS 2", XII1 = "XII IPA 1";
/** [id siswa, nama, kelas]; s1..s6 sama dengan demoStudents & persona siswa demo. */
const ROSTER: readonly (readonly [string, string, string])[] = [
  ["s1", "Alya Putri Ramadhani", X1], ["s2", "Bima Aditya Pratama", X1], ["s3", "Citra Ayu Lestari", XI2], ["s5", "Elena Safira", XII1], ["s6", "Farhan Maulana", XI1],
  ["d07", "Gilang Ramadhan", X2], ["d08", "Hana Salsabila", X2], ["d09", "Indra Kusuma", XI1], ["d10", "Jihan Aulia", XI2], ["d11", "Kevin Pratama Wijaya", XII1],
  ["d12", "Laras Ayuningtyas", X1], ["d13", "Muhammad Rafi Akbar", X1], ["d14", "Nadia Kirana", X2], ["d15", "Oktaviani Putri", XI1], ["d16", "Putra Mahendra", XI2],
  ["d17", "Qonita Zahra", XII1], ["d18", "Rizky Firmansyah", X1], ["d19", "Salsa Nabila Putri", XI1], ["d20", "Teguh Santoso", XI2], ["d21", "Umi Kalsum", XII1],
  ["d22", "Vina Oktavia", X1], ["d23", "Wahyu Hidayat", X2], ["d24", "Yoga Pratama", XI1], ["d25", "Zaskia Amelia", XI2], ["d26", "Anisa Rahmawati", XII1],
  ["d27", "Bagus Setiawan", X1], ["d28", "Dewi Lestari Anggraini", X2], ["d29", "Eko Prasetyo", XI1], ["d30", "Fitri Handayani", XI2], ["d31", "Galih Saputra", XII1],
  ["d32", "Intan Permatasari", X1], ["d33", "Joko Susilo", X2], ["d34", "Kartika Sari", XI1], ["d35", "Lutfi Hakim", XI2], ["d36", "Maya Puspita", XII1],
  ["d37", "Nanda Pratiwi", X2], ["d38", "Rahmat Hidayatullah", XI1], ["d39", "Sekar Ayu Wulandari", XII1], ["d40", "Taufik Hidayat", XI2], ["d41", "Wulan Dari", X1],
  ["d42", "Yusuf Maulana", XII1], ["d43", "Ayu Kartika Dewi", X2], ["d44", "Dimas Anggara", XI1],
];

type Spot = readonly [north: number, east: number];
/** [id siswa, jam masuk, posisi, akurasi GPS (m), flag anomali (terurut)]. */
type LocatedSpec = readonly [string, string, Spot, number, (readonly AnomalyCode[])?];

/** Titik ke-k di sekitar gedung (sudut emas): 5–18 m dari gedung, rapat tapi tidak identik. */
const nearBuilding = (k: number): Spot => {
  const r = 5 + k * 0.75, angle = k * 2.39996;
  return [BUILDING[0] + r * Math.sin(angle), BUILDING[1] + r * Math.cos(angle)];
};

const LOCATED: readonly LocatedSpec[] = [
  // 8 siswa X IPA 1 dari ruang kelas yang sama: koordinat persis sama.
  ["s2", "06:42", BUILDING, 18], ["d12", "06:35", BUILDING, 18], ["d13", "06:51", BUILDING, 18], ["d22", "06:47", BUILDING, 18],
  ["d27", "07:02", BUILDING, 18], ["d32", "06:58", BUILDING, 18], ["d41", "06:59", BUILDING, 18, ["SHARED_DEVICE"]], ["d18", "07:22", BUILDING, 18],
  // 18 siswa lain bergerombol di sekitar gedung yang sama.
  ...(["s6", "d07", "d08", "d09", "d10", "d11", "d14", "d15", "d16", "d17", "d19", "d24", "d25", "d26", "d28", "d29", "d30", "d34"] as const).map((id, k): LocatedSpec => {
    const late: Record<string, string> = { d16: "07:18", d29: "07:26" };
    // Yoga (d24): wajah tidak terdeteksi saat foto diambil -> antrean "Perlu ditinjau" (B1).
    const flags: Record<string, readonly AnomalyCode[]> = { d24: ["FACE_NOT_DETECTED"] };
    return [id, late[id] ?? `06:${String(20 + k * 2).padStart(2, "0")}`, nearBuilding(k), 8 + (k % 5) * 3, flags[id]];
  }),
  // Tersebar di area sekolah: gerbang, lapangan, kantin (dua titik berdekatan), perpustakaan.
  ["s3", "07:31", [-95, 10], 14], ["d36", "06:44", [-20, -85], 11], ["d38", "06:53", [5, 72], 9], ["d39", "06:56", [8, 75], 10],
  ["d43", "07:05", [70, -60], 62, ["LOW_ACCURACY"]],
  // Di luar radius, diterima karena toleransi akurasi GPS.
  ["d23", "07:40", [-150, 80], 48, ["GEOFENCE_TOLERANCE", "NEW_DEVICE"]], ["d20", "07:47", [120, -130], 55, ["DEVICE_SESSION_MISMATCH", "GEOFENCE_TOLERANCE"]],
];

/** [id siswa, status, catatan]. */
const UNLOCATED: readonly (readonly [string, LeaveStatus, string | null])[] = [
  ["s5", "IZIN", "Acara keluarga di luar kota."], ["d21", "IZIN", "Mengikuti lomba OSN tingkat kota."], ["d31", "IZIN", "Keperluan keluarga."],
  ["d37", "SAKIT", "Demam, surat dokter terlampir."], ["d40", "SAKIT", "Sakit gigi, istirahat di rumah."],
  ["d44", "ALPHA", "Tidak hadir tanpa keterangan (dicatat wali kelas)."],
  ["s1", "BELUM_ABSEN", null], ["d33", "BELUM_ABSEN", null], ["d35", "BELUM_ABSEN", null], ["d42", "BELUM_ABSEN", null],
];

/** Alasan terlambat contoh (A1): diisi siswa 2 menit setelah absen; Citra (s3) belum mengisi. */
const LATE_REASONS: Readonly<Record<string, readonly [LateReasonCode, string | null]>> = {
  d16: ["TRANSPORT", null],
  d29: ["WEATHER", "Hujan deras, menunggu reda di halte."],
  d18: ["OVERSLEPT", null],
  d23: ["FAMILY", "Mengantar adik ke SD dulu."],
  d20: ["OTHER", "Ban sepeda bocor di jalan."],
};
const REASON_DELAY_MINUTES = 2;

/** Absen pulang contoh (2026-10-07): beberapa siswa sudah pulang; persona siswa sengaja belum agar alurnya bisa dicoba. */
const CHECK_OUTS: Readonly<Record<string, string>> = { d12: "14:02", d13: "14:05", d22: "14:11", d36: "14:20", d38: "14:07" };
const checkOutOf = (studentId: string): string | null => CHECK_OUTS[studentId] ?? null;

const FLAG_TEXT: Readonly<Partial<Record<AnomalyCode, readonly [string, AnomalySeverity]>>> = {
  DEVICE_SESSION_MISMATCH: ["Perangkat berbeda dengan perangkat saat login", "MEDIUM"],
  FACE_NOT_DETECTED: ["Wajah tidak terdeteksi otomatis saat foto diambil — periksa fotonya", "MEDIUM"],
  TEST_MODE: ["Diterima karena mode uji absensi (di luar area atau jam absen)", "MEDIUM"],
  GEOFENCE_TOLERANCE: ["Di luar radius, diterima karena toleransi akurasi GPS", "LOW"],
  LOW_ACCURACY: ["Akurasi GPS rendah", "LOW"],
  NEW_DEVICE: ["Perangkat baru (berganti dalam 7 hari terakhir)", "MEDIUM"],
  SHARED_DEVICE: ["Perangkat yang sama dipakai siswa lain hari ini", "HIGH"],
};

const rad = (deg: number) => (deg * Math.PI) / 180;
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const toCoord = ([north, east]: Spot) => ({
  latitude: round6(SCHOOL.latitude + (north / EARTH_M) * (180 / Math.PI)),
  longitude: round6(SCHOOL.longitude + (east / (EARTH_M * Math.cos(rad(SCHOOL.latitude)))) * (180 / Math.PI)),
});
function distanceFromSchool(p: { latitude: number; longitude: number }): number {
  const h = Math.sin(rad(p.latitude - SCHOOL.latitude) / 2) ** 2 + Math.cos(rad(SCHOOL.latitude)) * Math.cos(rad(p.latitude)) * Math.sin(rad(p.longitude - SCHOOL.longitude) / 2) ** 2;
  return Math.round(2 * EARTH_M * Math.asin(Math.sqrt(h)));
}

/** NIS/NISN mengikuti nomor id (s5 -> 2026005, d07 -> 2026007), sama dengan demoStudents. */
const student = (id: string) => {
  const [, name, className] = ROSTER.find(r => r[0] === id) ?? [id, id, X1];
  const seq = Number(id.slice(1));
  return { id, name, className, nis: `2026${String(seq).padStart(3, "0")}`, nisn: `00987654${String(seq + 31).padStart(2, "0")}` };
};
const attendanceIdOf = (id: string) => ({ s2: "demo-att-bima", s3: "demo-att-citra" } as Record<string, string>)[id] ?? `demo-att-${id}`;
const flagsHaveAnomaly = (flags: readonly AnomalyCode[]) => flags.some(code => FLAG_TEXT[code]?.[1] !== "LOW");

function toPoint([id, time, spot, accuracyM, flags = []]: LocatedSpec): MapPoint {
  const s = student(id);
  const coord = toCoord(spot);
  return {
    attendanceId: attendanceIdOf(id), studentId: id, name: s.name, nis: s.nis, className: s.className,
    status: time > LATE_AFTER ? "TERLAMBAT" : "HADIR", ...coord, accuracyM, distanceM: distanceFromSchool(coord),
    checkInTimeLocal: time, hasAnomaly: flagsHaveAnomaly(flags), flags: [...flags], lateReasonCategory: LATE_REASONS[id]?.[0] ?? null,
    needsReview: flagsHaveAnomaly(flags), reviewDecision: null, checkOutTimeLocal: checkOutOf(id),
  };
}

function toUnlocated([id, status]: (typeof UNLOCATED)[number]): Unlocated {
  const s = student(id);
  return { studentId: id, name: s.name, nis: s.nis, className: s.className, status, attendanceId: status === "BELUM_ABSEN" ? null : attendanceIdOf(id) };
}

const POINTS: readonly MapPoint[] = LOCATED.map(toPoint);
const ENTRIES: readonly Unlocated[] = UNLOCATED.map(toUnlocated);

function countStatuses(points: readonly MapPoint[], unlocated: readonly Unlocated[]): MapDto["counts"] {
  const all = [...points.map(p => p.status), ...unlocated.map(u => u.status)];
  const n = (status: string) => all.filter(s => s === status).length;
  return { hadir: n("HADIR"), terlambat: n("TERLAMBAT"), izin: n("IZIN"), sakit: n("SAKIT"), alpha: n("ALPHA"), notYet: n("BELUM_ABSEN") };
}

const todayWib = () => localParts(new Date(), "WIB").ymd;
/** Sekolah 6 hari: Minggu libur — kecuali hari ini, agar peta contoh selalu bisa dicoba. */
const isDemoSchoolDay = (date: string) => date === todayWib() || new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;

/** Siswa demo (sama dengan peta): dipakai rekap bulanan demo (A3). */
export const DEMO_ROSTER: ReadonlyArray<{ readonly id: string; readonly name: string; readonly nis: string; readonly className: string }> = ROSTER.map(([id]) => {
  const { name, nis, className } = student(id);
  return { id, name, nis, className };
});

export interface DemoTodayRow {
  readonly studentId: string;
  readonly status: "HADIR" | "TERLAMBAT" | "IZIN" | "SAKIT" | "ALPHA";
  readonly lateMinutes: number | null;
  readonly lateReason: LateReasonCode | null;
}

/** Status hari ini per siswa dari peta contoh (setelah tinjauan demo): kolom hari ini rekap bulanan demo. */
export function demoTodayRows(date: string = todayWib()): DemoTodayRow[] {
  const map = demoAttendanceMap({ date });
  const minutesAfterStart = (time: string | null) => (time ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) - DAY_START_MINUTE : 0);
  const located = map.points.map((p): DemoTodayRow => ({
    studentId: p.studentId, status: p.status as DemoTodayRow["status"], lateMinutes: p.status === "TERLAMBAT" ? minutesAfterStart(p.checkInTimeLocal) : null, lateReason: p.lateReasonCategory ?? null,
  }));
  const others = map.unlocated.flatMap((u): DemoTodayRow[] => (u.status === "BELUM_ABSEN" ? [] : [{ studentId: u.studentId, status: u.status as DemoTodayRow["status"], lateMinutes: null, lateReason: null }]));
  return [...located, ...others];
}

export interface DemoMapOptions { readonly date?: string; readonly className?: string | null }

/** Peta check-in contoh (MapDto); filter kelas & tanggal diterapkan seperti server (counts ikut). */
export function demoAttendanceMap(options: DemoMapOptions = {}): MapDto {
  const date = options.date ?? todayWib();
  const isSchoolDay = isDemoSchoolDay(date);
  const inClass = (e: { className: string | null }) => !options.className || e.className === options.className;
  const points = isSchoolDay ? POINTS.map(withReview).filter(inClass) : [];
  const unlocated = isSchoolDay ? ENTRIES.filter(inClass) : [];
  return { date, isSchoolDay, school: { ...SCHOOL }, counts: countStatuses(points, unlocated), points, unlocated, truncated: false };
}

/** Baris "Data lengkap" (GET /school/attendance/daily) dari data yang SAMA dengan peta: urut kelas lalu nama. */
export function demoDailyRows(date: string = todayWib()): DailyRowDto[] {
  const map = demoAttendanceMap({ date });
  const brief = (id: string) => { const s = student(id); return { id, nis: s.nis, nisn: s.nisn, name: s.name, className: s.className }; };
  const located = map.points.map((p): DailyRowDto => ({ student: brief(p.studentId), attendance: pointBrief(p, date) }));
  const others = map.unlocated.map((u): DailyRowDto => {
    const detail = u.attendanceId ? demoAttendanceDetail(u.attendanceId, date) : null;
    return { student: brief(u.studentId), attendance: detail && { id: detail.id, status: detail.status, source: detail.source, checkInTimeLocal: null, lateMinutes: null, distanceM: null, accuracyM: null, hasAnomaly: false, flags: [], leaveRequestId: detail.leaveRequestId, note: detail.note, lateReason: null, needsReview: false, reviewDecision: null, checkOutTimeLocal: null } };
  });
  return [...located, ...others].sort((a, b) => (a.student.className ?? "").localeCompare(b.student.className ?? "") || a.student.name.localeCompare(b.student.name));
}

const briefOf = (id: string) => { const s = student(id); return { id, nis: s.nis, nisn: s.nisn, name: s.name, className: s.className }; };

/** Ringkasan catatan check-in (bentuk MonitorAttendanceBrief) setelah tinjauan demo diterapkan. */
function pointBrief(p: MapPoint, date: string): DailyRowDto["attendance"] & object {
  const review = reviewOf(p.attendanceId, date);
  const invalid = review?.decision === "INVALID";
  return {
    id: p.attendanceId, status: p.status, source: invalid ? "ADMIN" : "CHECKIN", checkInTimeLocal: p.checkInTimeLocal,
    lateMinutes: p.status === "TERLAMBAT" ? minuteOf(p.checkInTimeLocal ?? "07:00") - DAY_START_MINUTE : null, distanceM: p.distanceM, accuracyM: p.accuracyM,
    hasAnomaly: p.hasAnomaly, flags: p.flags, leaveRequestId: null, note: invalid ? review.note : null, lateReason: lateReasonOf(p, date),
    needsReview: p.needsReview, reviewDecision: p.reviewDecision, checkOutTimeLocal: checkOutOf(p.studentId),
  };
}

/** Antrean anomali contoh (GET /school/attendance/anomalies) dari data peta yang SAMA, sesuai filter tinjauan. */
export function demoAnomalyRows(filter: AnomalyReviewFilter = "UNREVIEWED", date: string = todayWib()): AnomalyRowDto[] {
  const keep = (p: MapPoint) => filter === "ALL_ANOMALIES" || (filter === "UNREVIEWED" ? p.reviewDecision === null : p.reviewDecision === filter);
  return demoAttendanceMap({ date }).points.filter(p => p.hasAnomaly && keep(p))
    .map(p => ({ date, student: briefOf(p.studentId), attendance: pointBrief(p, date), reviewDecision: p.reviewDecision }));
}

/** Hitungan alasan terlambat contoh dari data peta yang SAMA (6 terlambat: 5 diisi, 1 belum). */
export function demoLateReasonCounts(date: string = todayWib()): LateReasonCountsDto {
  const late = demoAttendanceMap({ date }).points.filter(p => p.status === "TERLAMBAT");
  const counts = countLateReasons(late.map(p => ({ category: p.lateReasonCategory, source: "CHECKIN", count: 1 })));
  return { from: `${date.slice(0, 7)}-01`, to: date, ...counts };
}

const REVIEW_FILTERS: readonly AnomalyReviewFilter[] = ["UNREVIEWED", "VALID", "INVALID", "ALL_ANOMALIES"];
const reviewFilterOf = (value: unknown): AnomalyReviewFilter => REVIEW_FILTERS.find(f => f === value) ?? "UNREVIEWED";

/** Jalur persis monitoring; `params` = filter tampilan (mis. review antrean anomali). */
export function demoMonitorRows(path: string, params: Readonly<Record<string, unknown>> = {}): unknown {
  if (path === "/school/attendance/map") return demoAttendanceMap();
  if (path === "/school/attendance/daily") return demoDailyRows();
  if (path === "/school/attendance/anomalies") return demoAnomalyRows(reviewFilterOf(params.review));
  if (path === "/school/attendance/late-reasons") return demoLateReasonCounts();
  return undefined;
}

const minuteOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const isoAt = (date: string, minute: number, secondsBack = 0) => new Date(instantAtLocal(date, minute, "WIB").getTime() - secondsBack * 1000).toISOString();

function lateReasonOf(point: MapPoint, date: string): LateReasonDto | null {
  // Alasan tetap dikirim setelah "Tidak valid" (status menjadi ALPHA), seperti server: UI menandai "sebelum dikoreksi".
  const reason = LATE_REASONS[point.studentId];
  if (!reason) return null;
  const minute = minuteOf(point.checkInTimeLocal ?? "07:00") + REASON_DELAY_MINUTES;
  return { category: reason[0], note: reason[1], timeLocal: formatMinute(minute), updatedAt: isoAt(date, minute) };
}

function detailBase(id: string, date: string): Omit<RecordDetailDto, "status" | "source"> {
  const s = student(id);
  const created = isoAt(date, 6 * 60);
  return {
    id: attendanceIdOf(id), date, checkInAt: null, checkInTimeLocal: null, lateMinutes: null, latitude: null, longitude: null,
    accuracyM: null, distanceM: null, isMocked: null, deviceId: null, locationCapturedAt: null, hasAnomaly: false, flags: [],
    leaveRequestId: null, note: null, lateReason: null, needsReview: false, reviewDecision: null, review: null, classId: null, className: s.className, student: { id, nis: s.nis, nisn: s.nisn, name: s.name, className: s.className },
    selfie: null, checkOutTimeLocal: null, checkOut: null, rejectionsSameDay: [], audit: [], createdAt: created, updatedAt: created,
  };
}

function demoCheckOut(point: MapPoint, date: string, deviceId: string): RecordDetailDto["checkOut"] {
  const time = checkOutOf(point.studentId);
  if (!time) return null;
  return {
    at: isoAt(date, minuteOf(time)), timeLocal: time, latitude: point.latitude, longitude: point.longitude, accuracyM: point.accuracyM,
    distanceM: point.distanceM, deviceId, selfie: { fileId: `demo-selfie-out-${point.studentId}`, url: null, purged: false },
  };
}

function reviewDto(review: DemoReview | null): RecordDetailDto["review"] {
  return review && { decision: review.decision, note: review.note, reviewedAt: review.reviewedAt, reviewer: review.reviewer };
}

function pointDetail(point: MapPoint, date: string): RecordDetailDto {
  const brief = pointBrief(point, date);
  const minute = minuteOf(point.checkInTimeLocal ?? "07:00");
  const at = isoAt(date, minute);
  const deviceId = `android-${point.studentId}`;
  const outside = (point.distanceM ?? 0) > SCHOOL.radiusM;
  const rejection = { id: `demo-rej-${point.studentId}`, reason: "OUTSIDE_GEOFENCE" as const, reasonLabel: "Di luar area sekolah", latitude: round6(point.latitude + 0.0004), longitude: point.longitude, accuracyM: 64, distanceM: (point.distanceM ?? 0) + 44, isMocked: false, deviceId, timeLocal: `${String(Math.floor((minute - 4) / 60)).padStart(2, "0")}:${String((minute - 4) % 60).padStart(2, "0")}`, createdAt: isoAt(date, minute - 4) };
  return {
    ...detailBase(point.studentId, date), status: point.status, source: brief.source, checkInAt: at, checkInTimeLocal: point.checkInTimeLocal,
    lateMinutes: brief.lateMinutes, note: brief.note, needsReview: brief.needsReview, reviewDecision: brief.reviewDecision, review: reviewDto(reviewOf(point.attendanceId, date)),
    latitude: point.latitude, longitude: point.longitude,
    accuracyM: point.accuracyM, distanceM: point.distanceM, isMocked: false, deviceId, locationCapturedAt: isoAt(date, minute, 6),
    hasAnomaly: point.hasAnomaly, flags: point.flags.map(code => ({ code, label: FLAG_TEXT[code]?.[0] ?? code, severity: FLAG_TEXT[code]?.[1] ?? "LOW" })), lateReason: lateReasonOf(point, date),
    selfie: { fileId: `demo-selfie-${point.studentId}`, url: null, purged: false }, rejectionsSameDay: outside ? [rejection] : [], createdAt: at, updatedAt: at,
    checkOutTimeLocal: brief.checkOutTimeLocal, checkOut: demoCheckOut(point, date, deviceId),
  };
}

/** Detail catatan contoh per attendanceId (tanpa permintaan jaringan); id tak dikenal -> null. */
export function demoAttendanceDetail(attendanceId: string, date: string = todayWib()): RecordDetailDto | null {
  const base = POINTS.find(p => p.attendanceId === attendanceId);
  const point = base && withReview(base);
  if (point) return pointDetail(point, date);
  const entry = UNLOCATED.find(([id, status]) => status !== "BELUM_ABSEN" && attendanceIdOf(id) === attendanceId);
  if (!entry) return null;
  const [id, status, note] = entry;
  const leave = status === "IZIN" || status === "SAKIT";
  return { ...detailBase(id, date), status: status as RecordDetailDto["status"], source: leave ? "LEAVE" : "ADMIN", leaveRequestId: leave ? `demo-leave-${id}` : null, note };
}

export interface DemoReviewInput { readonly decision: "VALID" | "INVALID"; readonly note?: string | null; readonly flags: readonly string[] }

/**
 * Tinjau anomali di mode demo memakai aturan murni yang SAMA dengan server (rencana, catatan wajib, flag berubah);
 * pelanggaran dilempar sebagai ApiError. Keputusan hanya tersimpan di memori halaman.
 */
export function applyDemoReview(attendanceId: string, input: DemoReviewInput, reviewer: { id: string; name: string }, now: Date = new Date()): AnomalyReviewResultDto {
  const date = todayWib();
  const point = demoAttendanceMap({ date }).points.find(p => p.attendanceId === attendanceId);
  if (!point) throw new ApiError("Catatan absensi tidak ditemukan.", "NOT_FOUND");
  const plan = planAnomalyReview({ hasAnomaly: point.hasAnomaly, decision: point.reviewDecision }, input.decision);
  if (plan.kind === "violation") throw new ApiError(plan.violation.message, plan.violation.code);
  const problem = reviewNoteProblem(input.decision, input.note);
  if (problem) throw new ApiError(problem, "VALIDATION_FAILED");
  if (plan.kind !== "unchanged" && !sameFlagSet(point.flags, input.flags)) throw new ApiError(FLAGS_CHANGED.message, FLAGS_CHANGED.code);
  const statusChanged = plan.kind === "invalidate" && point.status !== "ALPHA";
  if (plan.kind !== "unchanged") saveDemoReview(attendanceId, { decision: input.decision, note: normalizeReviewNote(input.note), reviewedAt: now.toISOString(), reviewer });
  const detail = demoAttendanceDetail(attendanceId, date);
  if (!detail) throw new ApiError("Catatan absensi tidak ditemukan.", "NOT_FOUND");
  const attendance = {
    id: detail.id, studentId: detail.student.id, classId: detail.classId, date, status: detail.status, source: detail.source, lateMinutes: detail.lateMinutes,
    checkInAt: detail.checkInAt, note: detail.note, leaveRequestId: detail.leaveRequestId, hasAnomaly: detail.hasAnomaly, updatedAt: now.toISOString(),
    needsReview: detail.needsReview, review: detail.review,
  };
  return { attendance, unchanged: plan.kind === "unchanged", statusChanged };
}
