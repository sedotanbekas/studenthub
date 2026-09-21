/**
 * Konteks bersama seed demo fase P3 (SPP, rapor, pengumuman). Berbeda dari seed P1/P2 yang menulis
 * baris langsung, data P3 dibuat lewat SERVICE domain (aturan, penomoran, kunci, notifikasi & audit
 * yang sama dengan API) dengan ActionContext milik akun demo dan jam `now` yang bisa dimundurkan
 * agar riwayat bulan lalu realistis. Hanya dipanggil seed demo (DB *_staging / *_dev / *_test).
 */
import type { SchoolTimezone } from "@prisma/client";
import type { ActionContext, Principal } from "../../src/lib/auth/principal";
import { prisma } from "../../src/lib/db";
import { AppError } from "../../src/lib/http/errors";
import { DEMO_ACADEMIC_YEAR, demoAdminEmail, type DemoSchoolSpec } from "./demo-data";

export const DEMO_SESSION_ID = "seed-demo";

export interface DemoStudentRef {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly nisn: string;
  readonly className: string;
  /** Urutan siswa di spesifikasi demo (dasar pola deterministik). */
  readonly index: number;
}

export interface DemoSchoolRef {
  readonly schoolId: string;
  readonly timezone: SchoolTimezone;
  readonly admin: { readonly id: string; readonly name: string };
  /** Semester Ganjil tahun ajaran demo. */
  readonly ganjilTermId: string;
  /** Nama kelas -> id (tahun ajaran demo). */
  readonly classIds: ReadonlyMap<string, string>;
  /** Siswa demo berstatus ACTIVE, urut spesifikasi. */
  readonly students: readonly DemoStudentRef[];
}

/** Id sekolah, admin, semester Ganjil, kelas, dan siswa demo aktif (setelah seedDemoSchool). */
export async function loadDemoSchoolRef(spec: DemoSchoolSpec): Promise<DemoSchoolRef> {
  const school = await prisma.school.findUniqueOrThrow({ where: { npsn: spec.npsn }, select: { id: true, timezone: true } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: demoAdminEmail(spec) }, select: { id: true, name: true } });
  const year = await prisma.academicYear.findUniqueOrThrow({
    where: { schoolId_name: { schoolId: school.id, name: DEMO_ACADEMIC_YEAR.name } },
    select: { id: true, terms: { where: { semester: "GANJIL" }, select: { id: true } }, classes: { select: { id: true, name: true } } },
  });
  const ganjilTermId = year.terms[0]?.id;
  if (!ganjilTermId) throw new Error(`Semester Ganjil demo untuk ${spec.npsn} tidak ditemukan`);
  const rows = await prisma.student.findMany({
    where: { schoolId: school.id, nisn: { in: spec.students.map((s) => s.nisn) }, status: "ACTIVE" },
    select: { id: true, userId: true, nisn: true, user: { select: { name: true } }, currentClass: { select: { name: true } } },
    take: spec.students.length,
  });
  const byNisn = new Map(rows.map((row) => [row.nisn, row]));
  const students = spec.students.flatMap((s, index) => {
    const row = byNisn.get(s.nisn);
    return row ? [{ id: row.id, userId: row.userId, name: row.user.name, nisn: row.nisn, className: row.currentClass?.name ?? "", index }] : [];
  });
  return {
    schoolId: school.id,
    timezone: school.timezone,
    admin,
    ganjilTermId,
    classIds: new Map(year.classes.map((c) => [c.name, c.id])),
    students,
  };
}

function demoContext(principal: Principal, now: Date): ActionContext {
  return { principal, now, requestId: `${DEMO_SESSION_ID}-${now.getTime()}`, ip: null, userAgent: "seed-demo", defer: () => undefined };
}

/** Admin sekolah demo (push dikirim tick cron, bukan kick setelah respons). */
export function adminContext(ref: DemoSchoolRef, now: Date): ActionContext {
  return demoContext(
    {
      userId: ref.admin.id, sessionId: DEMO_SESSION_ID, role: "SCHOOL_ADMIN", name: ref.admin.name, schoolId: ref.schoolId, sponsorId: null,
      studentId: null, studentStatus: null, sponsorStatus: null, mustChangePassword: false, platform: "WEB", deviceId: null,
    },
    now,
  );
}

export function studentContext(ref: DemoSchoolRef, student: DemoStudentRef, now: Date): ActionContext {
  return demoContext(
    {
      userId: student.userId, sessionId: DEMO_SESSION_ID, role: "STUDENT", name: student.name, schoolId: ref.schoolId, sponsorId: null,
      studentId: student.id, studentStatus: "ACTIVE", sponsorStatus: null, mustChangePassword: false, platform: "ANDROID", deviceId: null,
    },
    now,
  );
}

/** Instant rencana yang belum terjadi dipotong ke `now` (seed tidak pernah menulis masa depan). */
export const clampToNow = (instant: Date, now: Date): Date => (instant.getTime() > now.getTime() ? now : instant);

/**
 * Jalankan satu bagian seed; pelanggaran aturan domain (AppError 4xx, mis. data staging sudah diubah
 * admin) dicatat sebagai peringatan agar deploy staging tidak gagal. Galat lain tetap dilempar.
 */
export async function collectDomainWarning(label: string, warnings: string[], run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof AppError) || error.status >= 500) throw error;
    warnings.push(`${label}: ${error.code} ${error.message}`);
  }
}
