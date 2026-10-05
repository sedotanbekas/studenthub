import { ALL_ROLES, ALL_SPONSOR_STATUSES, ALL_STUDENT_STATUSES, type PolicyRule } from "./types";

/** Aksi POLICY domain notifications. */
export const notificationsPolicy = {
  /** Pilihan kabar sekolah akun sendiri (N2): admin utama & admin tambahan. */
  "notification.preferences": { roles: ["SCHOOL_ADMIN"] },
  /** Langganan Web Push sesi web sendiri (N3): semua peran; ditolak selama wajib ganti kata sandi. */
  // Langganan Web Push mengikat browser ke sesi: tidak pada sesi "Masuk sebagai" (browser super admin bukan HP pemilik akun).
  "notification.push": { roles: ALL_ROLES, studentStatuses: ALL_STUDENT_STATUSES, sponsorStatuses: ALL_SPONSOR_STATUSES, blockedWhenImpersonating: true },
} as const satisfies Record<string, PolicyRule>;
