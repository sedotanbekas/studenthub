/**
 * Logika seed demo: fungsi ensureX() kecil yang idempoten (upsert berdasarkan kunci alami:
 * School.npsn, AcademicYear[schoolId,name], Term[academicYearId,semester], SchoolClass[academicYearId,name],
 * Subject[schoolId,code], User.email, Student[schoolId,nisn]). Data P3 (tagihan SPP, rapor, pengumuman)
 * dibuat SETELAH transaksi sekolah lewat service domain (demo-billing.ts, demo-academic.ts). Dipanggil CLI
 * scripts/seed-demo.ts dan integration test. Penjaga nama database ada di CLI (checkSeedDatabaseUrl), BUKAN di sini.
 */
import type { Tx } from "../../src/lib/db";
import { toDbDate } from "../../src/lib/time/zone";
import { withTx } from "../../src/lib/tx";
import { ensureDemoAnnouncements, ensureDemoReportCards, type DemoReportCardSummary } from "./demo-academic";
import { ensureDemoAttendance } from "./demo-attendance";
import { ensureDemoBilling, type DemoBillingSummary } from "./demo-billing";
import { loadDemoSchoolRef } from "./demo-context";
import {
  DEMO_ACADEMIC_YEAR,
  DEMO_ACTIVATED_AT,
  DEMO_KKM,
  DEMO_SCHOOLS,
  DEMO_SUPER_ADMIN,
  demoAdminEmail,
  type DemoClassSpec,
  type DemoSchoolSpec,
  type DemoStudentSpec,
  type DemoSubjectSpec,
} from "./demo-data";

export interface DemoSeedOptions {
  /** Hash bcrypt DEMO_PASSWORD (CLI: cost 10). Dipakai semua akun demo. */
  readonly passwordHash: string;
  /** Jam acuan seed (default: sekarang). */
  readonly now?: Date;
}

export interface DemoSchoolBaseSummary {
  readonly name: string;
  readonly npsn: string;
  readonly timezone: string;
  readonly adminEmail: string;
  readonly classes: number;
  readonly subjects: number;
  readonly classSubjects: number;
  readonly activeStudents: number;
  readonly nisnRange: string;
}

export interface DemoSchoolSummary extends DemoSchoolBaseSummary {
  readonly billing: DemoBillingSummary;
  readonly reportCards: DemoReportCardSummary;
  /** Pengumuman demo berstatus terbit. */
  readonly announcements: number;
  /** Bagian seed P3 yang dilewati (mis. STORAGE_ROOT tak dapat ditulis, data staging sudah diubah). */
  readonly warnings: readonly string[];
}

export interface DemoSeedSummary {
  readonly superAdminEmail: string;
  readonly schools: readonly DemoSchoolSummary[];
}

type NameToId = ReadonlyMap<string, string>;

/** Kolom akun demo yang di-reset setiap seed: kata sandi = DEMO_PASSWORD, aktif, tanpa wajib ganti. */
function accountFields(name: string, options: DemoSeedOptions) {
  return { name, passwordHash: options.passwordHash, isActive: true, mustChangePassword: false, tempPasswordExpiresAt: null };
}

export async function ensureSuperAdmin(tx: Tx, options: DemoSeedOptions): Promise<string> {
  const fields = { ...accountFields(DEMO_SUPER_ADMIN.name, options), role: "SUPER_ADMIN" as const, schoolId: null, sponsorId: null };
  const user = await tx.user.upsert({
    where: { email: DEMO_SUPER_ADMIN.email },
    create: { ...fields, email: DEMO_SUPER_ADMIN.email },
    update: fields,
    select: { id: true },
  });
  return user.id;
}

export async function ensureSchool(tx: Tx, spec: DemoSchoolSpec): Promise<string> {
  const data = {
    name: spec.name,
    address: spec.address,
    provinceCode: spec.provinceCode,
    cityCode: spec.cityCode,
    latitude: spec.latitude,
    longitude: spec.longitude,
    geofenceRadiusM: spec.geofenceRadiusM,
    timezone: spec.timezone,
    ...spec.bank,
    isActive: true,
  };
  const school = await tx.school.upsert({ where: { npsn: spec.npsn }, create: { ...data, npsn: spec.npsn }, update: data, select: { id: true } });
  return school.id;
}

/** Tahun ajaran + semester Ganjil/Genap; mengembalikan id tahun ajaran dan id semester aktif. */
export async function ensureAcademicYear(tx: Tx, schoolId: string): Promise<{ academicYearId: string; activeTermId: string }> {
  const { name, startDate, endDate, terms } = DEMO_ACADEMIC_YEAR;
  const dates = { startDate: toDbDate(startDate), endDate: toDbDate(endDate) };
  const year = await tx.academicYear.upsert({
    where: { schoolId_name: { schoolId, name } },
    create: { schoolId, name, ...dates },
    update: dates,
    select: { id: true },
  });
  let activeTermId = "";
  for (const term of terms) {
    const termDates = { startDate: toDbDate(term.startDate), endDate: toDbDate(term.endDate) };
    const row = await tx.term.upsert({
      where: { academicYearId_semester: { academicYearId: year.id, semester: term.semester } },
      create: { schoolId, academicYearId: year.id, semester: term.semester, ...termDates },
      update: termDates,
      select: { id: true },
    });
    if (term.active) activeTermId = row.id;
  }
  await tx.school.update({ where: { id: schoolId }, data: { activeTermId } });
  return { academicYearId: year.id, activeTermId };
}

export async function ensureClasses(tx: Tx, schoolId: string, academicYearId: string, classes: readonly DemoClassSpec[]): Promise<NameToId> {
  const entries: Array<[string, string]> = [];
  for (const spec of classes) {
    const row = await tx.schoolClass.upsert({
      where: { academicYearId_name: { academicYearId, name: spec.name } },
      create: { schoolId, academicYearId, name: spec.name, gradeLevel: spec.gradeLevel },
      update: { gradeLevel: spec.gradeLevel, isActive: true },
      select: { id: true },
    });
    entries.push([spec.name, row.id]);
  }
  return new Map(entries);
}

export async function ensureSubjects(tx: Tx, schoolId: string, subjects: readonly DemoSubjectSpec[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [index, spec] of subjects.entries()) {
    const data = { name: spec.name, kkm: DEMO_KKM, sortOrder: index + 1, isActive: true };
    const row = await tx.subject.upsert({
      where: { schoolId_code: { schoolId, code: spec.code } },
      create: { schoolId, code: spec.code, ...data },
      update: data,
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

/** Setiap mapel dipetakan ke setiap kelas (dasar kelengkapan rapor). */
export async function ensureClassSubjects(tx: Tx, classIds: readonly string[], subjectIds: readonly string[]): Promise<void> {
  const data = classIds.flatMap((classId) => subjectIds.map((subjectId, index) => ({ classId, subjectId, sortOrder: index + 1 })));
  await tx.classSubject.createMany({ data, skipDuplicates: true });
}

export async function ensureSchoolAdmin(tx: Tx, schoolId: string, spec: DemoSchoolSpec, options: DemoSeedOptions): Promise<string> {
  const email = demoAdminEmail(spec);
  const fields = { ...accountFields(spec.adminName, options), role: "SCHOOL_ADMIN" as const, schoolId, sponsorId: null };
  const user = await tx.user.upsert({ where: { email }, create: { ...fields, email }, update: fields, select: { id: true } });
  return user.id;
}

function studentFields(spec: DemoStudentSpec, classId: string) {
  return {
    nis: spec.nis,
    gender: spec.gender,
    birthPlace: spec.birthPlace,
    birthDate: toDbDate(spec.birthDate),
    address: spec.address,
    guardianName: spec.guardianName,
    guardianPhone: spec.guardianPhone,
    status: "ACTIVE" as const,
    activeNisn: spec.nisn,
    currentClassId: classId,
    sppAmount: null,
  };
}

/** Siswa ACTIVE lengkap-aktivasi. User siswa tak punya kunci alami, jadi dicari lewat Student[schoolId,nisn]. */
export async function ensureStudent(tx: Tx, schoolId: string, classIds: NameToId, spec: DemoStudentSpec, options: DemoSeedOptions): Promise<string> {
  const classId = classIds.get(spec.className);
  if (!classId) throw new Error(`Kelas demo "${spec.className}" tidak ditemukan untuk siswa ${spec.nisn}`);
  const existing = await tx.student.findUnique({
    where: { schoolId_nisn: { schoolId, nisn: spec.nisn } },
    select: { id: true, userId: true, activatedAt: true },
  });
  if (existing) {
    await tx.user.update({ where: { id: existing.userId }, data: accountFields(spec.name, options) });
    await tx.student.update({
      where: { id: existing.id },
      data: { ...studentFields(spec, classId), activatedAt: existing.activatedAt ?? DEMO_ACTIVATED_AT },
    });
    return existing.id;
  }
  const created = await tx.user.create({
    data: {
      ...accountFields(spec.name, options),
      role: "STUDENT",
      email: null,
      schoolId,
      student: { create: { ...studentFields(spec, classId), schoolId, nisn: spec.nisn, activatedAt: DEMO_ACTIVATED_AT } },
    },
    select: { student: { select: { id: true } } },
  });
  if (!created.student) throw new Error(`Siswa demo ${spec.nisn} gagal dibuat`);
  return created.student.id;
}

async function summarizeSchool(tx: Tx, spec: DemoSchoolSpec, schoolId: string, academicYearId: string): Promise<DemoSchoolBaseSummary> {
  const nisns = spec.students.map((s) => s.nisn);
  return {
    name: spec.name,
    npsn: spec.npsn,
    timezone: spec.timezone,
    adminEmail: demoAdminEmail(spec),
    classes: await tx.schoolClass.count({ where: { schoolId, academicYearId } }),
    subjects: await tx.subject.count({ where: { schoolId } }),
    classSubjects: await tx.classSubject.count({ where: { schoolClass: { schoolId, academicYearId } } }),
    activeStudents: await tx.student.count({ where: { schoolId, status: "ACTIVE" } }),
    nisnRange: `${nisns[0] ?? "-"} s.d. ${nisns.at(-1) ?? "-"}`,
  };
}

/** Satu sekolah demo dalam satu transaksi (gagal di tengah = tidak ada data setengah jadi). */
export async function seedDemoSchool(spec: DemoSchoolSpec, options: DemoSeedOptions, now: Date = new Date()): Promise<DemoSchoolBaseSummary> {
  return withTx(async (tx) => {
    const schoolId = await ensureSchool(tx, spec);
    const { academicYearId } = await ensureAcademicYear(tx, schoolId);
    const classIds = await ensureClasses(tx, schoolId, academicYearId, spec.classes);
    const subjectIds = await ensureSubjects(tx, schoolId, spec.subjects);
    await ensureClassSubjects(tx, [...classIds.values()], subjectIds);
    await ensureSchoolAdmin(tx, schoolId, spec, options);
    for (const student of spec.students) await ensureStudent(tx, schoolId, classIds, student, options);
    await ensureDemoAttendance(tx, schoolId, spec.students.map((s) => s.nisn), now);
    return summarizeSchool(tx, spec, schoolId, academicYearId);
  });
}

/** Data P3 satu sekolah (transaksi service masing-masing, setelah transaksi sekolah selesai). */
async function seedDemoSchoolP3(spec: DemoSchoolSpec, base: DemoSchoolBaseSummary, now: Date): Promise<DemoSchoolSummary> {
  const ref = await loadDemoSchoolRef(spec);
  const warnings: string[] = [];
  const billing = await ensureDemoBilling(ref, spec, now, warnings);
  const reportCards = await ensureDemoReportCards(ref, spec, now, warnings);
  const announcements = await ensureDemoAnnouncements(ref, spec, now, warnings);
  return { ...base, billing, reportCards, announcements, warnings };
}

/** Seluruh dataset demo. Aman dijalankan berulang (setiap deploy staging). */
export async function runDemoSeed(options: DemoSeedOptions): Promise<DemoSeedSummary> {
  const now = options.now ?? new Date();
  await withTx((tx) => ensureSuperAdmin(tx, options));
  const schools: DemoSchoolSummary[] = [];
  for (const spec of DEMO_SCHOOLS) schools.push(await seedDemoSchoolP3(spec, await seedDemoSchool(spec, options, now), now));
  return { superAdminEmail: DEMO_SUPER_ADMIN.email, schools };
}
