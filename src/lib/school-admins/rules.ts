import { conflict, forbidden } from "@/lib/http/errors";

/**
 * Aturan murni pengelolaan akun admin tambahan oleh ADMIN UTAMA sekolah (keputusan pemilik 2026-10-02:
 * guru/wali kelas memakai akun admin sekolah masing-masing; super admin cukup membuat admin utama).
 * Admin utama sendiri (login NPSN) hanya diubah super admin lewat /platform/users.
 */
/** Akun admin tidak pernah dihapus, jadi batas menghitung yang aktif maupun nonaktif. */
export const MAX_SCHOOL_ADMINS = 100;

export function assertManageableAdmin(target: { readonly isPrimary: boolean }): void {
  if (target.isPrimary) {
    throw forbidden("PRIMARY_ADMIN_PROTECTED", "Akun admin utama hanya dapat diubah oleh super admin.");
  }
}

/** Endpoint ini hanya membuat admin TAMBAHAN; admin utama (login NPSN) dibuat super admin lewat /platform/users. */
export function assertHasPrimaryAdmin(hasPrimary: boolean): void {
  if (!hasPrimary) {
    throw conflict("PRIMARY_ADMIN_MISSING", "Sekolah ini belum punya admin utama. Buat admin utama lewat menu Pengguna (super admin) terlebih dahulu.");
  }
}

export function assertAdminQuota(existingAdmins: number): void {
  if (existingAdmins >= MAX_SCHOOL_ADMINS) {
    throw conflict("SCHOOL_ADMIN_LIMIT", `Sekolah ini sudah memiliki ${MAX_SCHOOL_ADMINS} akun admin. Hubungi super admin bila perlu menambah lagi.`);
  }
}
