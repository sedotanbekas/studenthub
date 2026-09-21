/**
 * Pembantu integration test job absensi (auto-ALPHA, sinkronisasi kalender, koreksi, retensi).
 * Semua job dipanggil langsung dengan JobContext ber-scope sekolah/user milik test sendiri.
 */
import type { AttendanceSource, AttendanceStatus, Prisma, School, SchoolTimezone } from "@prisma/client";
import type { ActionContext, JobContext } from "@/lib/auth/principal";
import { resetEnvCache } from "@/lib/env";
import { addDays, localParts, toDbDate, type LocalDate } from "@/lib/time/zone";
import { prisma, uniq } from "../../helpers/db";
import { createAcademicYearWithTerm, createSchool, createStoredFile } from "../../helpers/factories";

const JOB_BUDGET_MS = 120_000;

/**
 * Notifikasi siswa (push PENDING) menjadwalkan kick push lewat ctx.defer; di luar request Next `after()`
 * tidak tersedia, jadi test menjalankan antrean defer secara inline. Mengembalikan fungsi pemulih.
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

export function jobCtx(now: Date, scope: { schoolIds?: readonly string[]; userIds?: readonly string[] } = {}): JobContext {
  return { now, requestId: uniq("req"), deadline: Date.now() + JOB_BUDGET_MS, scope };
}

export function actionCtx(now: Date = new Date()): ActionContext {
  return { principal: null, now, requestId: uniq("req"), ip: null, userAgent: null, defer: () => undefined };
}

export interface AttendanceSchoolOptions {
  readonly timezone?: SchoolTimezone;
  readonly createdAt: Date;
  /** Rentang semester (inklusif) yang mencakup tanggal uji. */
  readonly termStart: LocalDate;
  readonly termEnd: LocalDate;
  readonly data?: Partial<Prisma.SchoolUncheckedCreateInput>;
}

/** Sekolah dengan semua hari = hari sekolah (mask 127) dan semester aktif yang mencakup tanggal uji. */
export async function createAttendanceSchool(options: AttendanceSchoolOptions): Promise<School> {
  const school = await createSchool({
    timezone: options.timezone ?? "WIB",
    data: { schoolDaysMask: 127, createdAt: options.createdAt, ...options.data },
  });
  const firstYear = Number(options.termStart.slice(0, 4));
  await createAcademicYearWithTerm(school.id, {
    name: `${firstYear}/${firstYear + 1}`,
    yearStart: addDays(options.termStart, -1),
    yearEnd: addDays(options.termEnd, 1),
    termStart: options.termStart,
    termEnd: options.termEnd,
  });
  return school;
}

export interface RowInput {
  readonly schoolId: string;
  readonly studentId: string;
  readonly date: LocalDate;
  readonly classId?: string | null;
}

export function autoAlphaRow(input: RowInput) {
  return prisma.attendance.create({
    data: { schoolId: input.schoolId, studentId: input.studentId, classId: input.classId ?? null, date: toDbDate(input.date), status: "ALPHA", source: "AUTO_ALPHA" },
  });
}

export function adminRow(input: RowInput, status: AttendanceStatus = "HADIR") {
  return prisma.attendance.create({
    data: { schoolId: input.schoolId, studentId: input.studentId, date: toDbDate(input.date), status, source: "ADMIN", note: "Koreksi uji" },
  });
}

export async function leaveRequest(input: { schoolId: string; studentId: string; from: LocalDate; to: LocalDate; status: "APPROVED" | "PENDING"; type?: "IZIN" | "SAKIT" }) {
  return prisma.leaveRequest.create({
    data: {
      schoolId: input.schoolId,
      studentId: input.studentId,
      type: input.type ?? "IZIN",
      startDate: toDbDate(input.from),
      endDate: toDbDate(input.to),
      reason: "Acara keluarga di luar kota",
      status: input.status,
    },
  });
}

export async function leaveRow(input: RowInput & { leaveRequestId: string; status?: "IZIN" | "SAKIT" }) {
  return prisma.attendance.create({
    data: {
      schoolId: input.schoolId,
      studentId: input.studentId,
      date: toDbDate(input.date),
      status: input.status ?? "IZIN",
      source: "LEAVE",
      leaveRequestId: input.leaveRequestId,
    },
  });
}

export interface CheckInRowInput extends RowInput {
  readonly userId: string;
  readonly deviceId: string;
  readonly status?: AttendanceStatus;
  readonly lateMinutes?: number | null;
  readonly anomalyFlags?: string[];
}

/** Baris CHECKIN lengkap (lolos chk_attendance_checkin): selfie (metadata saja), koordinat, perangkat. */
export async function checkInRow(input: CheckInRowInput) {
  const selfie = await createStoredFile(input.userId, "ATTENDANCE_SELFIE", { schoolId: input.schoolId, attachedAt: new Date() });
  const source: AttendanceSource = "CHECKIN";
  return prisma.attendance.create({
    data: {
      schoolId: input.schoolId,
      studentId: input.studentId,
      classId: input.classId ?? null,
      date: toDbDate(input.date),
      status: input.status ?? "HADIR",
      lateMinutes: input.lateMinutes ?? null,
      source,
      checkInAt: new Date(`${input.date}T00:30:00.000Z`),
      latitude: "-6.9147000",
      longitude: "107.6098000",
      accuracyM: 12,
      distanceM: 30,
      deviceId: input.deviceId,
      selfieFileId: selfie.id,
      ...(input.anomalyFlags ? { anomalyFlags: input.anomalyFlags, hasAnomaly: false } : {}),
    },
  });
}

/** Hari ini lokal WIB (jam nyata) — untuk test lewat route yang memakai jam server. */
export const wibToday = (): LocalDate => localParts(new Date(), "WIB").ymd;

/** Tanggal libur nasional yang ada di DB dalam rentang (test tidak boleh memilih tanggal ini). */
export async function nationalHolidayDates(from: LocalDate, to: LocalDate): Promise<ReadonlySet<LocalDate>> {
  const rows = await prisma.holiday.findMany({
    where: { schoolId: null, startDate: { lte: toDbDate(to) }, endDate: { gte: toDbDate(from) } },
    select: { startDate: true, endDate: true },
  });
  const dates = new Set<LocalDate>();
  for (const row of rows) {
    for (let d = row.startDate.toISOString().slice(0, 10); d <= row.endDate.toISOString().slice(0, 10); d = addDays(d, 1)) dates.add(d);
  }
  return dates;
}

/** Hari ke belakang (offset dari hari ini WIB) pertama yang bukan libur nasional. */
export async function pastSchoolDate(preferredOffsets: readonly number[]): Promise<LocalDate> {
  const today = wibToday();
  const blocked = await nationalHolidayDates(addDays(today, -120), today);
  const offset = preferredOffsets.find((days) => !blocked.has(addDays(today, -days)));
  if (offset === undefined) throw new Error("Tidak ada tanggal uji yang bebas libur nasional");
  return addDays(today, -offset);
}
