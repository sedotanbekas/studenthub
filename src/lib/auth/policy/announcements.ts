import { ADMINS, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain pengumuman. Admin sekolah (sekolahnya sendiri) & super admin (wajib ?schoolId=)
 * membaca dan mengelola pengumuman; siswa menerima pengumuman lewat inbox (`notification.self`).
 */
export const announcementsPolicy = {
  "announcements.read": { roles: ADMINS },
  "announcements.manage": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
