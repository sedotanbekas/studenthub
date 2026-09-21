import { ADMINS, ALL_STUDENT_STATUSES, type PolicyRule } from "./types";

/** Aksi POLICY domain calendar (libur sekolah, libur nasional, kalender siswa). */
export const calendarPolicy = {
  "calendar.read": { roles: ADMINS },
  "calendar.manage": { roles: ADMINS },
  "calendar.national.read": { roles: ["SUPER_ADMIN"] },
  "calendar.national.manage": { roles: ["SUPER_ADMIN"] },
  "calendar.student.read": { roles: ["STUDENT"], studentStatuses: ALL_STUDENT_STATUSES },
} as const satisfies Record<string, PolicyRule>;
