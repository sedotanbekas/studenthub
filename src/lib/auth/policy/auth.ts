import type { PolicyRule } from "./types";

/**
 * Aksi POLICY domain auth. /auth/login & /auth/refresh bersifat publik; endpoint self-service lain
 * (/auth/logout(-all), /auth/me, /auth/change-password, /me/sessions*, /me/push-token) memakai aksi inti
 * `auth.self` di core.ts. `auth.totp` = pendaftaran TOTP super admin (/me/totp/*): tetap diizinkan selama
 * TOTP belum aktif, tetapi TIDAK saat wajib ganti kata sandi (ganti kata sandi dulu, baru TOTP); juga
 * dipakai "Lupakan perangkat tepercaya" (DELETE /me/trusted-devices). `auth.email` = admin sekolah
 * menambah/mengubah email login sendiri (PUT /me/email), setelah kata sandi awal diganti.
 */
export const authPolicy = {
  "auth.totp": { roles: ["SUPER_ADMIN"], allowDuringTotpEnrollment: true, blockedWhenImpersonating: true },
  "auth.email": { roles: ["SCHOOL_ADMIN"], blockedWhenImpersonating: true },
} as const satisfies Record<string, PolicyRule>;
