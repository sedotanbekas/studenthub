import type { PolicyRule } from "./types";

/**
 * Aksi POLICY domain auth. Sengaja kosong: /auth/login & /auth/refresh bersifat publik, dan semua
 * endpoint self-service lain (/auth/logout(-all), /auth/me, /auth/change-password, /me/sessions*,
 * /me/push-token) memakai aksi inti `auth.self` di core.ts (semua peran, semua status siswa/sponsor,
 * tetap diizinkan saat wajib ganti kata sandi).
 */
export const authPolicy = {} as const satisfies Record<string, PolicyRule>;
