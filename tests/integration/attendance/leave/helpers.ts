/**
 * Helper integrasi izin/sakit: sekolah dengan semua hari = hari sekolah (mask 127) dan semester yang
 * mencakup hari ini ±90 hari, admin + siswa bertoken, form multipart, foto uji (sharp), dan pemilih
 * tanggal yang menghindari libur nasional sisa test lain (DB test dipakai ulang tanpa reset).
 */
import sharp from "sharp";
import type { AttendanceSource, AttendanceStatus, School, SchoolClass } from "@prisma/client";
import { resetEnvCache } from "@/lib/env";
import { addDays, eachDate, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { createSessionToken } from "../../helpers/auth";
import { prisma, uniq } from "../../helpers/db";
import {
  createAcademicYearWithTerm,
  createClass,
  createSchool,
  createSchoolAdmin,
  createStoredFile,
  createStudent,
  createSuperAdmin,
  type TestStudent,
  type TestUser,
} from "../../helpers/factories";

export { callMultipart } from "../../students/helpers";

/**
 * Notifikasi siswa (push PENDING) menjadwalkan kick push lewat ctx.defer; di luar request Next `after()`
 * tidak tersedia, jadi test menjalankan antrean defer secara inline. Kembalikan fungsi pemulih.
 */
export function useInlineDefer(): () => void {
  const previous = process.env.DEFER_MODE;
  process.env.DEFER_MODE = "inline";
  resetEnvCache();
  return () => {
    if (previous === undefined) delete process.env.DEFER_MODE;
    else process.env.DEFER_MODE = previous;
    resetEnvCache();
  };
}

export interface LeaveSchoolFixture {
  readonly school: School;
  readonly klass: SchoolClass;
  readonly admin: TestUser;
  readonly adminToken: string;
}

export interface StudentWithToken extends TestStudent {
  readonly token: string;
}

/** Hari ini lokal (WIB) menurut jam proses test = jam server route. */
export const todayWib = (): LocalDate => localParts(new Date(), "WIB").ymd;

export async function webToken(userId: string): Promise<string> {
  return (await createSessionToken(userId, { platform: "WEB", deviceId: null })).token;
}

export async function createLeaveSchool(): Promise<LeaveSchoolFixture> {
  const school = await createSchool({ data: { schoolDaysMask: 127 } });
  const today = todayWib();
  const { academicYear } = await createAcademicYearWithTerm(school.id, {
    yearStart: addDays(today, -150), yearEnd: addDays(today, 200), termStart: addDays(today, -90), termEnd: addDays(today, 90),
  });
  const klass = await createClass(school.id, academicYear.id, { name: uniq("VIII") });
  const admin = await createSchoolAdmin(school.id);
  return { school, klass, admin, adminToken: await webToken(admin.id) };
}

export async function createStudentWithToken(fixture: LeaveSchoolFixture, options: Parameters<typeof createStudent>[1] = {}): Promise<StudentWithToken> {
  const created = await createStudent(fixture.school.id, { classId: fixture.klass.id, ...options });
  return { ...created, token: (await createSessionToken(created.user.id)).token };
}

export async function superAdminToken(): Promise<string> {
  return webToken((await createSuperAdmin()).id);
}

/** Tanggal libur nasional (schoolId NULL) dalam rentang — sisa test lain bisa jatuh di dekat hari ini. */
export async function nationalHolidayDates(from: LocalDate, to: LocalDate): Promise<Set<LocalDate>> {
  const rows = await prisma.holiday.findMany({
    where: { schoolId: null, startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(from) } },
    select: { startDate: true, endDate: true },
  });
  const dates = rows.flatMap((row) => eachDate(row.startDate.toISOString().slice(0, 10), row.endDate.toISOString().slice(0, 10)));
  return new Set(dates);
}

/** Hari sekolah (mask 127 + semester luas) = tanggal yang bukan libur nasional. */
export async function schoolDaysBetween(from: LocalDate, to: LocalDate): Promise<LocalDate[]> {
  const holidays = await nationalHolidayDates(from, to);
  return eachDate(from, to).filter((date) => !holidays.has(date));
}

/**
 * Tanggal mulai pertama >= today+minOffset dengan `length` hari berturut-turut tanpa libur nasional.
 * Gagal eksplisit bila tidak ada (lingkungan test tercemar berat).
 */
export async function freeRun(minOffset: number, length: number, maxOffset = 30): Promise<{ startDate: LocalDate; endDate: LocalDate }> {
  const today = todayWib();
  const holidays = await nationalHolidayDates(addDays(today, minOffset), addDays(today, maxOffset));
  for (let offset = minOffset; offset + length - 1 <= maxOffset; offset += 1) {
    const dates = eachDate(addDays(today, offset), addDays(today, offset + length - 1));
    if (dates.every((date) => !holidays.has(date))) return { startDate: dates[0] ?? today, endDate: dates.at(-1) ?? today };
  }
  throw new Error(`Tidak ada ${length} hari berturut-turut tanpa libur nasional antara +${minOffset} dan +${maxOffset}`);
}

let photoSeed = 0;
/** Foto uji JPEG 800x1000 (warna berbeda tiap panggilan). */
export async function photo(): Promise<Blob> {
  photoSeed += 1;
  const bytes = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: (photoSeed * 37) % 256, g: 120, b: 80 } } })
    .jpeg()
    .toBuffer();
  return new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
}

export interface LeaveFormFields {
  readonly type?: "IZIN" | "SAKIT";
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
  readonly reason?: string;
  readonly studentId?: string;
  readonly note?: string;
  readonly attachment?: Blob;
  readonly extra?: Readonly<Record<string, string>>;
}

export function leaveForm(fields: LeaveFormFields): FormData {
  const form = new FormData();
  form.set("type", fields.type ?? "IZIN");
  form.set("startDate", fields.startDate);
  form.set("endDate", fields.endDate);
  form.set("reason", fields.reason ?? "Acara keluarga di luar kota");
  if (fields.studentId) form.set("studentId", fields.studentId);
  if (fields.note) form.set("note", fields.note);
  if (fields.attachment) form.set("attachment", fields.attachment, "surat.jpg");
  for (const [key, value] of Object.entries(fields.extra ?? {})) form.set(key, value);
  return form;
}

export interface AttendanceSeed {
  readonly date: LocalDate;
  readonly source: AttendanceSource;
  readonly status?: AttendanceStatus;
}

/** Sisipkan baris absensi langsung (CHECKIN memakai StoredFile selfie + koordinat sesuai CHECK). */
export async function seedAttendance(fixture: LeaveSchoolFixture, student: TestStudent, seed: AttendanceSeed): Promise<string> {
  const base = { schoolId: fixture.school.id, studentId: student.student.id, classId: fixture.klass.id, date: toDbDate(seed.date), source: seed.source };
  if (seed.source === "CHECKIN") {
    const selfie = await createStoredFile(student.user.id, "ATTENDANCE_SELFIE", { schoolId: fixture.school.id });
    const row = await prisma.attendance.create({
      data: { ...base, status: seed.status ?? "HADIR", checkInAt: new Date(), latitude: "-6.9147000", longitude: "107.6098000", selfieFileId: selfie.id },
    });
    return row.id;
  }
  const status = seed.status ?? (seed.source === "AUTO_ALPHA" ? "ALPHA" : "HADIR");
  return (await prisma.attendance.create({ data: { ...base, status } })).id;
}

export const leaveUrl = (path: string, schoolId?: string): string =>
  `/api/v1/school/leave-requests${path}${schoolId ? `?schoolId=${encodeURIComponent(schoolId)}` : ""}`;
