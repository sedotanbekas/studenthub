import type { PolicyRule } from "./types";

/**
 * Aksi POLICY domain auth. /auth/login & /auth/refresh bersifat publik; endpoint self-service lain
 * (/auth/logout(-all), /auth/me, /auth/change-password, /me/sessions*, /me/push-token) memakai aksi inti
 * `auth.self` di core.ts. `auth.totp` = pendaftaran TOTP super admin (/me/totp/*): tetap diizinkan selama
 * TOTP belum aktif, tetapi TIDAK saat wajib ganti kata sandi (ganti kata sandi dulu, baru TOTP).
 */
export const authPolicy = {
  "auth.totp": { roles: ["SUPER_ADMIN"], allowDuringTotpEnrollment: true },
} as const satisfies Record<string, PolicyRule>;
