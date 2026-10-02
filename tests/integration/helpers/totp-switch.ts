import { resetEnvCache } from "../../../src/lib/env";

/**
 * Berkas test perilaku TOTP menyalakan sakelar SUPER_ADMIN_TOTP (bawaan "off" sejak 2026-10-02). Tiap berkas
 * test integrasi berjalan di prosesnya sendiri, jadi sakelar tidak bocor ke berkas lain. Cache env direset
 * karena modul yang diimpor lebih dulu bisa sudah membaca env.
 */
export function enforceSuperAdminTotp(): void {
  process.env.SUPER_ADMIN_TOTP = "on";
  resetEnvCache();
}
