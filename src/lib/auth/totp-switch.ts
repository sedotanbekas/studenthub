import { getEnv } from "@/lib/env";

/**
 * Sakelar TOTP super admin (env SUPER_ADMIN_TOTP, bawaan "off" sejak keputusan pemilik 2026-10-02).
 * Mati: super admin tidak wajib mendaftar TOTP dan login tidak meminta kode; pembeda pemakai akun diganti
 * riwayat masuk (src/lib/login-history). Rahasia TOTP yang sudah terdaftar tidak dihapus.
 */
export function superAdminTotpEnforced(): boolean {
  return getEnv().SUPER_ADMIN_TOTP === "on";
}
