import { ALL_ROLES, ALL_SPONSOR_STATUSES, ALL_STUDENT_STATUSES, type PolicyRule } from "./types";

/** Aksi lintas domain (inti platform). Domain lain menambah berkas policy/<domain>.ts. */
export const corePolicy = {
  "auth.self": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
    allowDuringPasswordChange: true,
    allowDuringTotpEnrollment: true,
    // Keluar & akhiri "Masuk sebagai" tetap boleh pada mode lihat.
    allowWhenImpersonating: true,
  },
  /**
   * Keamanan akun milik pemiliknya (ganti kata sandi, keluar dari semua perangkat, cabut sesi, token push HP): seperti
   * auth.self tetapi ditolak pada sesi "Masuk sebagai" super admin (2026-10-05).
   */
  "auth.account": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
    allowDuringPasswordChange: true,
    allowDuringTotpEnrollment: true,
    blockedWhenImpersonating: true,
  },
  "notification.self": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
  },
  "file.read": {
    roles: ALL_ROLES,
    studentStatuses: ALL_STUDENT_STATUSES,
    sponsorStatuses: ALL_SPONSOR_STATUSES,
  },
  "region.read": {
    roles: ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR"],
    sponsorStatuses: ALL_SPONSOR_STATUSES,
  },
  "platform.jobs.read": { roles: ["SUPER_ADMIN"] },
  /** Nama & logo aplikasi (menu Pengaturan aplikasi, 2026-10-07). Membaca identitas aplikasi publik (GET /app/branding). */
  "app.settings": { roles: ["SUPER_ADMIN"] },
} as const satisfies Record<string, PolicyRule>;
