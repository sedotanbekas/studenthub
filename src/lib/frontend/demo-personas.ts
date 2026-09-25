import type { TodayDto } from "@/lib/attendance/student-schemas";
import { demoToday } from "./demo";
import type { Identity, Role } from "./types";

/**
 * Persona mode demo: "masuk" sebagai peran tertentu tanpa akun & tanpa kata sandi. Semua data contoh
 * disimulasikan di browser; tidak ada permintaan ke database. Nama & sekolah fiktif.
 */
export interface DemoPersona {
  readonly key: string;
  readonly label: string;
  readonly caption: string;
  readonly identity: Identity;
  readonly className?: string;
  /** Id siswa demo (lihat demoStudents) — dipakai agar persona siswa hanya melihat datanya sendiri. */
  readonly studentId?: string;
  readonly todayRecord?: TodayDto["record"];
}

const SCHOOL = { id: "demo-school", name: "SMA Cendekia Nusantara", timezone: "WIB" };

function persona(key: string, label: string, caption: string, role: Role, name: string, extra: Partial<Identity> & Pick<DemoPersona, "className" | "todayRecord" | "studentId"> = {}): DemoPersona {
  const { className, todayRecord, studentId, ...identity } = extra;
  return {
    key, label, caption, className, todayRecord, studentId,
    identity: { user: { id: `demo:${key}`, name, email: null, role, mustChangePassword: false, totpEnrollmentRequired: false }, school: role === "SCHOOL_ADMIN" || role === "STUDENT" ? SCHOOL : null, sponsor: null, permissions: [], ...identity },
  };
}

export const DEMO_PERSONAS: readonly DemoPersona[] = [
  persona("SCHOOL_ADMIN", "Admin sekolah", "Adinda Putri", "SCHOOL_ADMIN", "Adinda Putri"),
  persona("STUDENT", "Siswa · Alya", "X IPA 1 · belum absen", "STUDENT", "Alya Putri Ramadhani", { className: "X IPA 1", studentId: "s1" }),
  persona("STUDENT_BIMA", "Siswa · Bima", "X IPA 1 · sudah hadir", "STUDENT", "Bima Aditya Pratama", { className: "X IPA 1", studentId: "s2", todayRecord: { id: "demo-att-bima", status: "HADIR", source: "CHECKIN", checkInTimeLocal: "06:42", lateMinutes: null } }),
  persona("STUDENT_CITRA", "Siswa · Citra", "XI IPS 2 · terlambat", "STUDENT", "Citra Ayu Lestari", { className: "XI IPS 2", studentId: "s3", todayRecord: { id: "demo-att-citra", status: "TERLAMBAT", source: "CHECKIN", checkInTimeLocal: "07:31", lateMinutes: 31 } }),
  persona("SPONSOR", "Sponsor", "PT Cahaya Ilmu Nusantara", "SPONSOR", "Rizky Pratama", { sponsor: { id: "demo-sponsor", companyName: "PT Cahaya Ilmu Nusantara" } }),
  persona("SUPER_ADMIN", "Super admin", "Pengelola platform", "SUPER_ADMIN", "Dimas Wicaksono"),
];

/** Persona berdasarkan kunci; kunci tak dikenal -> admin sekolah. */
export function demoPersona(key: string | null): DemoPersona {
  return DEMO_PERSONAS.find(p => p.key === key) ?? DEMO_PERSONAS[0]!;
}

export function demoPersonaForUser(userId: string): DemoPersona | undefined {
  return DEMO_PERSONAS.find(p => p.identity.user.id === userId);
}

/** Status absen hari ini untuk siswa demo (tiap siswa punya kondisi berbeda). */
export function demoTodayFor(key: string): TodayDto {
  const base = demoToday as unknown as TodayDto;
  const record = demoPersona(key).todayRecord ?? null;
  return record ? { ...base, record, canCheckIn: false, blockReason: "ALREADY_CHECKED_IN" } : base;
}
