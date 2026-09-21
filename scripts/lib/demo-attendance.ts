/**
 * Data absensi demo (hanya lewat seed demo: DB *_staging / *_dev / *_test, dijaga CLI seed-demo.ts).
 * Untuk 10 hari sekolah terakhir SEBELUM hari ini (aturan kalender sekolah: mask hari, libur, semester),
 * setiap siswa demo mendapat baris absensi sumber ADMIN (tanpa selfie; chk_attendance_checkin hanya
 * berlaku untuk CHECKIN) bercatatan "data demo": sebagian besar HADIR, sebagian TERLAMBAT, beberapa
 * IZIN/SAKIT/ALPHA; HADIR/TERLAMBAT diberi koordinat dekat sekolah agar Peta menampilkan titik.
 *
 * Idempoten (kunci alami studentId+date): baris yang belum ada dibuat; baris demo lama & baris
 * AUTO_ALPHA ditulis ulang dengan nilai demo yang sama (pola deterministik per tanggal); baris asli
 * (CHECKIN, LEAVE, koreksi admin) TIDAK pernah ditimpa.
 */
import type { AttendanceStatus, SchoolTimezone } from "@prisma/client";
import { listSchoolDays } from "../../src/lib/calendar/rules";
import type { Tx } from "../../src/lib/db";
import { addDays, fromDbDate, instantAtLocal, localParts, toDbDate, type LocalDate } from "../../src/lib/time/zone";

export const DEMO_ATTENDANCE_DAYS = 10;
export const DEMO_ATTENDANCE_NOTE = "data demo";
/** Cukup untuk menemukan 10 hari sekolah walau melewati libur panjang. */
const LOOKBACK_DAYS = 45;
const PATTERN_SIZE = 20;
const HADIR_SLOTS = 14;
const TERLAMBAT_SLOTS = 3;
const METERS_PER_DEGREE = 111_320;
const OFFSET_STEP_M = 9;
const MS_PER_DAY = 86_400_000;

export interface DemoSchedule {
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
}

export interface DemoDayPlan {
  readonly status: AttendanceStatus;
  readonly lateMinutes: number | null;
  readonly checkInMinute: number | null;
  /** Geser (utara, timur) dalam meter dari titik sekolah; null = tanpa lokasi. */
  readonly offset: { readonly northM: number; readonly eastM: number } | null;
  readonly accuracyM: number;
}

/** Nomor hari sejak epoch: indeks pola stabil per tanggal (jendela bergeser tidak mengubah tanggal lama). */
export const dayNumber = (date: LocalDate): number => Math.round(Date.parse(`${date}T00:00:00.000Z`) / MS_PER_DAY);

/** Rencana deterministik siswa ke-s pada hari ke-d: ~70% HADIR, 15% TERLAMBAT, masing-masing 5% IZIN/SAKIT/ALPHA. */
export function demoDayPlan(studentIndex: number, day: number, schedule: DemoSchedule): DemoDayPlan {
  const slot = (studentIndex * 7 + day * 3) % PATTERN_SIZE;
  const accuracyM = 5 + ((studentIndex + day) % 20);
  const offset = { northM: (((studentIndex * 13 + day * 5) % 11) - 5) * OFFSET_STEP_M, eastM: (((studentIndex + day * 2) % 11) - 5) * OFFSET_STEP_M };
  if (slot < HADIR_SLOTS) {
    return { status: "HADIR", lateMinutes: null, checkInMinute: schedule.startMinute - 30 + ((studentIndex * 3 + day) % 30), offset, accuracyM };
  }
  if (slot < HADIR_SLOTS + TERLAMBAT_SLOTS) {
    const late = schedule.lateToleranceMinutes + 1 + ((studentIndex + day) % 30);
    return { status: "TERLAMBAT", lateMinutes: late, checkInMinute: schedule.startMinute + late, offset, accuracyM };
  }
  const status: AttendanceStatus = slot === PATTERN_SIZE - 3 ? "IZIN" : slot === PATTERN_SIZE - 2 ? "SAKIT" : "ALPHA";
  return { status, lateMinutes: null, checkInMinute: null, offset: null, accuracyM };
}

/** Titik sekolah digeser (utara, timur) meter; string 7 desimal (kolom Decimal(10,7)). */
export function offsetCoordinate(latitude: number, longitude: number, northM: number, eastM: number): { latitude: string; longitude: string } {
  const lat = latitude + northM / METERS_PER_DEGREE;
  const lng = longitude + eastM / (METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  return { latitude: lat.toFixed(7), longitude: lng.toFixed(7) };
}

export interface DemoSchool extends DemoSchedule {
  readonly timezone: SchoolTimezone;
  readonly latitude: number;
  readonly longitude: number;
}

export interface DemoRowKey {
  readonly schoolId: string;
  readonly studentId: string;
  readonly classId: string | null;
}

export interface DemoAttendanceRow extends DemoRowKey {
  readonly date: Date;
  readonly status: AttendanceStatus;
  readonly source: "ADMIN";
  readonly lateMinutes: number | null;
  readonly checkInAt: Date | null;
  readonly latitude: string | null;
  readonly longitude: string | null;
  readonly accuracyM: number | null;
  readonly distanceM: number | null;
  readonly note: string;
}

export function buildDemoRow(key: DemoRowKey, date: LocalDate, plan: DemoDayPlan, school: DemoSchool): DemoAttendanceRow {
  const located = plan.offset !== null && plan.checkInMinute !== null;
  const coords = plan.offset ? offsetCoordinate(school.latitude, school.longitude, plan.offset.northM, plan.offset.eastM) : null;
  return {
    ...key,
    date: toDbDate(date),
    status: plan.status,
    source: "ADMIN",
    lateMinutes: plan.lateMinutes,
    checkInAt: located && plan.checkInMinute !== null ? instantAtLocal(date, plan.checkInMinute, school.timezone) : null,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    accuracyM: located ? plan.accuracyM : null,
    distanceM: plan.offset ? Math.round(Math.hypot(plan.offset.northM, plan.offset.eastM)) : null,
    note: DEMO_ATTENDANCE_NOTE,
  };
}

async function loadDemoSchool(tx: Tx, schoolId: string) {
  const school = await tx.school.findUnique({
    where: { id: schoolId },
    select: { id: true, timezone: true, schoolDaysMask: true, latitude: true, longitude: true, startMinute: true, lateToleranceMinutes: true },
  });
  if (!school) throw new Error(`Sekolah demo ${schoolId} tidak ditemukan`);
  return { ...school, latitude: Number(school.latitude.toString()), longitude: Number(school.longitude.toString()) };
}

/** 10 hari sekolah terakhir sebelum hari ini (tanggal lokal sekolah). */
async function demoDates(tx: Tx, school: { id: string; timezone: SchoolTimezone; schoolDaysMask: number }, now: Date): Promise<LocalDate[]> {
  // Impor dinamis: modul kueri kalender memuat klien Prisma (unit test fungsi murni di berkas ini tanpa DB).
  const { loadCalendarContext } = await import("../../src/lib/calendar/queries");
  const today = localParts(now, school.timezone).ymd;
  const period = { from: addDays(today, -LOOKBACK_DAYS), to: addDays(today, -1) };
  return listSchoolDays(period.from, period.to, await loadCalendarContext(tx, school, period)).slice(-DEMO_ATTENDANCE_DAYS);
}

/** Baris yang boleh ditulis ulang seed: baris demo sebelumnya atau ALPHA otomatis (belum ada aktivitas asli). */
const isReplaceable = (row: { source: string; note: string | null }): boolean =>
  row.source === "AUTO_ALPHA" || (row.source === "ADMIN" && row.note === DEMO_ATTENDANCE_NOTE);

const sameDemoValues = (row: { source: string; status: string; lateMinutes: number | null; classId: string | null }, draft: DemoAttendanceRow): boolean =>
  row.source === draft.source && row.status === draft.status && row.lateMinutes === draft.lateMinutes && row.classId === draft.classId;

async function writeDemoRows(tx: Tx, drafts: readonly DemoAttendanceRow[]): Promise<{ created: number; updated: number }> {
  const existing = await tx.attendance.findMany({
    where: { studentId: { in: [...new Set(drafts.map((d) => d.studentId))] }, date: { in: [...new Set(drafts.map((d) => d.date.getTime()))].map((t) => new Date(t)) } },
    select: { id: true, studentId: true, date: true, source: true, status: true, lateMinutes: true, classId: true, note: true },
  });
  const byKey = new Map(existing.map((row) => [`${row.studentId}|${fromDbDate(row.date)}`, row]));
  const missing = drafts.filter((d) => !byKey.has(`${d.studentId}|${fromDbDate(d.date)}`));
  const created = missing.length > 0 ? (await tx.attendance.createMany({ data: [...missing], skipDuplicates: true })).count : 0;
  let updated = 0;
  for (const draft of drafts) {
    const row = byKey.get(`${draft.studentId}|${fromDbDate(draft.date)}`);
    if (!row || !isReplaceable(row) || sameDemoValues(row, draft)) continue;
    const { schoolId: _schoolId, studentId: _studentId, date: _date, ...values } = draft;
    // Compare-and-set: baris yang berubah sejak dibaca (mis. dikoreksi admin) tidak ditimpa.
    updated += (await tx.attendance.updateMany({ where: { id: row.id, source: row.source, note: row.note }, data: values })).count;
  }
  return { created, updated };
}

/** Pastikan absensi demo 10 hari sekolah terakhir untuk siswa demo (berdasarkan NISN) satu sekolah. */
export async function ensureDemoAttendance(tx: Tx, schoolId: string, nisns: readonly string[], now: Date): Promise<{ created: number; updated: number }> {
  const school = await loadDemoSchool(tx, schoolId);
  const dates = await demoDates(tx, school, now);
  const students = await tx.student.findMany({
    where: { schoolId, nisn: { in: [...nisns] }, status: "ACTIVE" },
    orderBy: { nisn: "asc" },
    select: { id: true, currentClassId: true, activatedAt: true },
    take: nisns.length,
  });
  const drafts = students.flatMap((student, index) =>
    dates
      .filter((date) => student.activatedAt !== null && localParts(student.activatedAt, school.timezone).ymd <= date)
      .map((date) => buildDemoRow({ schoolId, studentId: student.id, classId: student.currentClassId }, date, demoDayPlan(index, dayNumber(date), school), school)),
  );
  return drafts.length === 0 ? { created: 0, updated: 0 } : writeDemoRows(tx, drafts);
}
