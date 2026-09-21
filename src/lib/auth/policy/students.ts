import { ADMINS, ALL_STUDENT_STATUSES, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain students. Admin sekolah (sekolahnya sendiri) & super admin (wajib ?schoolId=)
 * mengelola siswa; siswa AKTIF/LULUS hanya membaca biodatanya sendiri.
 */
export const studentsPolicy = {
  "students.read": { roles: ADMINS },
  "students.manage": { roles: ADMINS },
  "students.import": { roles: ADMINS },
  "students.profile.read": { roles: ["STUDENT"], studentStatuses: ALL_STUDENT_STATUSES },
} as const satisfies Record<string, PolicyRule>;
