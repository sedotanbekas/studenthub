import { forbidden } from "@/lib/http/errors";
import type { Principal } from "../principal";
import { authPolicy } from "./auth";
import { schoolsPolicy } from "./schools";
import { usersPolicy } from "./users";
import { calendarPolicy } from "./calendar";
import { academicsPolicy } from "./academics";
import { studentsPolicy } from "./students";
import { notificationsPolicy } from "./notifications";
import { attendancePolicy } from "./attendance";
import { reportCardsPolicy } from "./report-cards";
import { billingPolicy } from "./billing";
import { announcementsPolicy } from "./announcements";
import { dashboardPolicy } from "./dashboard";
import { sponsorsPolicy } from "./sponsors";
import { adsPolicy } from "./ads";
import { corePolicy } from "./core";
import type { PolicyRule } from "./types";

/**
 * Peta POLICY tunggal: aksi inti + aksi tiap domain (satu berkas per domain di folder ini).
 */
export const POLICY = {
  ...corePolicy,
  ...authPolicy,
  ...schoolsPolicy,
  ...usersPolicy,
  ...calendarPolicy,
  ...academicsPolicy,
  ...studentsPolicy,
  ...notificationsPolicy,
  ...attendancePolicy,
  ...reportCardsPolicy,
  ...billingPolicy,
  ...announcementsPolicy,
  ...dashboardPolicy,
  ...sponsorsPolicy,
  ...adsPolicy,
} as const satisfies Record<string, PolicyRule>;

export type Action = keyof typeof POLICY;

export const isAction = (value: string): value is Action => Object.hasOwn(POLICY, value);

/** Melempar AppError 403 bila principal tidak boleh menjalankan aksi. */
export function authorize(principal: Principal, action: Action): void {
  const rule: PolicyRule = POLICY[action];
  if (!rule.roles.includes(principal.role)) {
    throw forbidden("FORBIDDEN", "Anda tidak memiliki akses untuk aksi ini.");
  }
  if (rule.blockedWhenImpersonating && principal.impersonatorId !== null) {
    throw forbidden("IMPERSONATION_FORBIDDEN", "Tidak tersedia saat Masuk sebagai: keamanan akun hanya bisa diubah pemiliknya.");
  }
  if (rule.primarySchoolAdminOnly && principal.role === "SCHOOL_ADMIN" && !principal.isPrimarySchoolAdmin) {
    throw forbidden("PRIMARY_ADMIN_ONLY", "Hanya admin utama sekolah yang dapat mengelola akun admin.");
  }
  if (principal.mustChangePassword && !rule.allowDuringPasswordChange) {
    throw forbidden("PASSWORD_CHANGE_REQUIRED", "Ganti kata sandi Anda terlebih dahulu.");
  }
  if (principal.totpEnrollmentRequired && !rule.allowDuringTotpEnrollment) {
    throw forbidden("TOTP_ENROLLMENT_REQUIRED", "Aktifkan verifikasi dua langkah (TOTP) terlebih dahulu lewat /me/totp/setup.");
  }
  if (principal.role === "STUDENT") {
    const allowed = rule.studentStatuses ?? ["ACTIVE"];
    if (!principal.studentStatus || !allowed.includes(principal.studentStatus)) {
      throw forbidden("STUDENT_NOT_ACTIVE", "Akun siswa tidak aktif untuk aksi ini.");
    }
  }
  if (principal.role === "SPONSOR") {
    const allowed = rule.sponsorStatuses ?? ["APPROVED"];
    if (!principal.sponsorStatus || !allowed.includes(principal.sponsorStatus)) {
      const suspended = principal.sponsorStatus === "SUSPENDED";
      throw forbidden(
        suspended ? "SPONSOR_SUSPENDED" : "SPONSOR_NOT_APPROVED",
        suspended ? "Akun sponsor ditangguhkan." : "Akun sponsor belum disetujui.",
      );
    }
  }
}

/**
 * "Masuk sebagai" = MODE LIHAT (tinjauan keamanan 2026-10-05): semua perubahan (metode selain GET) ditolak kecuali aksi
 * allowWhenImpersonating (keluar/akhiri). Default-deny agar endpoint baru tidak terbuka diam-diam atas nama pemilik akun.
 */
export function assertImpersonationAllowed(principal: Principal, action: Action, method: string): void {
  if (principal.impersonatorId === null || method === "GET") return;
  const rule: PolicyRule = POLICY[action];
  if (rule.allowWhenImpersonating) return;
  throw forbidden("IMPERSONATION_FORBIDDEN", "Mode lihat: perubahan data tidak tersedia saat Masuk sebagai. Pakai akun super admin untuk mengubah data.");
}

export function can(principal: Principal, action: Action): boolean {
  try {
    authorize(principal, action);
    return true;
  } catch {
    return false;
  }
}

export function listAllowedActions(principal: Principal): Action[] {
  return (Object.keys(POLICY) as Action[]).filter((action) => can(principal, action));
}
