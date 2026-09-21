import { ADMINS, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain sekolah. Lokasi/geofence/zona waktu/rekening hanya lewat schools.manage
 * (SUPER_ADMIN); admin sekolah hanya jadwal & hari sekolah lewat schools.settings.update.
 */
export const schoolsPolicy = {
  "schools.manage": { roles: ["SUPER_ADMIN"] },
  "schools.profile.read": { roles: ADMINS },
  "schools.settings.update": { roles: ADMINS },
} as const satisfies Record<string, PolicyRule>;
