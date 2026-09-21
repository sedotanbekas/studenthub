/**
 * Fixture check-in: sekolah dengan jadwal terkendali, siswa + principal/ctx dengan jam suntikan,
 * selfie buatan sharp, dan body multipart/JSON. Titik sekolah = default factory (-6.9147, 107.6098).
 */
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import sharp from "sharp";
import type { School, SchoolTimezone } from "@prisma/client";
import type { ActionContext, Principal } from "@/lib/auth/principal";
import { makePrincipal } from "@/lib/auth/test-principal";
import type { CheckInBody, PrecheckBody } from "@/lib/attendance/student-schemas";
import { addDays, instantAtLocal, type LocalDate } from "@/lib/time/zone";
import { prisma } from "../../helpers/db";
import { createAcademicYearWithTerm, createClass, createSchool, createStudent, type TestStudent } from "../../helpers/factories";

export const SCHOOL_POINT = { latitude: -6.9147, longitude: 107.6098 } as const;
/** deviceId default createSessionToken. */
export const DEVICE = "device-test-0001";
const METERS_PER_DEGREE_LAT = 111_195.1;

export interface ScheduleInput {
  readonly open: number;
  readonly start: number;
  readonly tolerance: number;
  readonly close: number;
  readonly dayEnd: number;
}

/** Jadwal default skema: buka 06:00, masuk 07:00, toleransi 15, tutup 10:00, akhir hari 15:00. */
export const DEFAULT_SCHEDULE: ScheduleInput = { open: 360, start: 420, tolerance: 15, close: 600, dayEnd: 900 };

export interface WorldOptions {
  readonly timezone?: SchoolTimezone;
  readonly schedule?: ScheduleInput;
  readonly termStart: LocalDate;
  readonly termEnd: LocalDate;
  readonly radiusM?: number;
  /** Default 127 (setiap hari) agar hari dalam minggu tidak memengaruhi uji. */
  readonly schoolDaysMask?: number;
}

export interface World {
  readonly school: School;
  readonly termId: string;
  readonly classId: string;
}

export async function createWorld(options: WorldOptions): Promise<World> {
  const s = options.schedule ?? DEFAULT_SCHEDULE;
  const school = await createSchool({
    timezone: options.timezone ?? "WIB",
    data: {
      checkInOpenMinute: s.open,
      startMinute: s.start,
      lateToleranceMinutes: s.tolerance,
      checkInCloseMinute: s.close,
      dayEndMinute: s.dayEnd,
      schoolDaysMask: options.schoolDaysMask ?? 127,
      geofenceRadiusM: options.radiusM ?? 150,
    },
  });
  const startYear = Number(options.termStart.slice(0, 4));
  const { academicYear, term } = await createAcademicYearWithTerm(school.id, {
    name: `${startYear}/${startYear + 1}`,
    yearStart: options.termStart,
    yearEnd: addDays(options.termEnd, 1),
    termStart: options.termStart,
    termEnd: options.termEnd,
  });
  const schoolClass = await createClass(school.id, academicYear.id);
  return { school, termId: term.id, classId: schoolClass.id };
}

export async function addStudent(world: World, options: Parameters<typeof createStudent>[1] = {}): Promise<TestStudent> {
  return createStudent(world.school.id, { classId: world.classId, ...options });
}

export function studentPrincipal(st: TestStudent, deviceId: string | null = DEVICE): Principal {
  return makePrincipal({
    userId: st.user.id,
    sessionId: `sess-${st.student.id}`,
    role: "STUDENT",
    name: st.user.name,
    schoolId: st.student.schoolId,
    studentId: st.student.id,
    studentStatus: st.student.status,
    deviceId,
  });
}

export function actionContext(principal: Principal, now: Date): ActionContext {
  return { principal, now, requestId: `test-${randomBytes(4).toString("hex")}`, ip: null, userAgent: null, defer: () => undefined };
}

/** Selfie 800x1000 warna solid (dHash selalu 0 -> jangan dipakai dua kali untuk siswa yang sama). */
export async function solidSelfie(): Promise<Buffer> {
  return sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 180, g: 120, b: 90 } } }).jpeg().toBuffer();
}

/** Selfie bertekstur acak (blok 9x8 acak diperbesar) -> dHash acak, praktis tidak pernah mirip satu sama lain. */
export async function texturedSelfie(): Promise<Buffer> {
  const raw = randomBytes(9 * 8 * 3);
  return sharp(raw, { raw: { width: 9, height: 8, channels: 3 } }).resize(720, 960, { kernel: "nearest" }).jpeg({ quality: 90 }).toBuffer();
}

/** Titik sejauh `meters` ke utara titik sekolah. */
export function pointAt(meters: number): { latitude: number; longitude: number } {
  return { latitude: SCHOOL_POINT.latitude + meters / METERS_PER_DEGREE_LAT, longitude: SCHOOL_POINT.longitude };
}

export interface FixOptions {
  readonly meters?: number;
  readonly accuracy?: number;
  readonly mocked?: boolean | null;
  readonly fixAgeMs?: number;
  readonly deviceId?: string;
}

/** Body check-in hasil parse (untuk memanggil service langsung). */
export function checkInBodyAt(now: Date, selfie: Buffer, options: FixOptions = {}): CheckInBody {
  const point = pointAt(options.meters ?? 20);
  return {
    selfie: new File([new Uint8Array(selfie)], "selfie.jpg", { type: "image/jpeg" }),
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: options.accuracy ?? 12,
    mocked: options.mocked === undefined ? false : options.mocked,
    locationTimestamp: now.getTime() - (options.fixAgeMs ?? 5_000),
    clientTime: now.getTime(),
    deviceId: options.deviceId ?? DEVICE,
  };
}

export function precheckBodyAt(now: Date, options: FixOptions = {}): PrecheckBody {
  const point = pointAt(options.meters ?? 20);
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracy: options.accuracy ?? 12,
    mocked: options.mocked === undefined ? false : options.mocked,
    locationTimestamp: now.getTime() - (options.fixAgeMs ?? 5_000),
    clientTime: now.getTime(),
  };
}

/** FormData multipart check-in (untuk memanggil route). */
export function checkInForm(now: Date, selfie: Buffer, options: FixOptions & { readonly extra?: Record<string, string> } = {}): FormData {
  const body = checkInBodyAt(now, selfie, options);
  const form = new FormData();
  form.set("selfie", body.selfie);
  form.set("latitude", String(body.latitude));
  form.set("longitude", String(body.longitude));
  form.set("accuracy", String(body.accuracy));
  if (body.mocked !== null) form.set("mocked", String(body.mocked));
  form.set("locationTimestamp", String(body.locationTimestamp));
  form.set("clientTime", String(body.clientTime));
  form.set("deviceId", body.deviceId);
  for (const [key, value] of Object.entries(options.extra ?? {})) form.set(key, value);
  return form;
}

/** Instant UTC untuk tanggal + jam lokal sekolah. */
export const localInstant = (date: LocalDate, minuteOfDay: number, timezone: SchoolTimezone): Date => instantAtLocal(date, minuteOfDay, timezone);

/** Semua kunci berkas di bawah root storage sementara (format kunci "private/..."). */
export async function storedKeysOnDisk(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => `${entry.parentPath}/${entry.name}`.slice(root.length + 1).replaceAll("\\", "/"))
    .filter((key) => key.startsWith("private/attendance-selfie/"));
}

/** Berkas selfie di disk yang tidak punya baris StoredFile (harus selalu kosong). */
export async function orphanSelfieKeys(root: string): Promise<string[]> {
  const onDisk = await storedKeysOnDisk(root);
  const rows = await prisma.storedFile.findMany({ where: { storageKey: { in: onDisk } }, select: { storageKey: true } });
  const known = new Set(rows.map((row) => row.storageKey));
  return onDisk.filter((key) => !known.has(key));
}
