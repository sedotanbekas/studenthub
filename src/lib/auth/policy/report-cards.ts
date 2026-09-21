import { ADMINS, ALL_STUDENT_STATUSES, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain rapor. Admin sekolah (sekolahnya sendiri) & super admin (wajib ?schoolId=) mengelola
 * nilai dan penerbitan; siswa AKTIF/LULUS hanya membaca rapor TERBIT miliknya sendiri.
 */
export const reportCardsPolicy = {
  /** Grid nilai, daftar, detail, dan cek kesiapan terbit. */
  "reportCards.read": { roles: ADMINS },
  /** Input nilai (massal & per rapor), buat rapor kosong, hapus rapor DRAFT. */
  "reportCards.manage": { roles: ADMINS },
  /** Terbitkan & tarik terbit. */
  "reportCards.publish": { roles: ADMINS },
  /** Rapor terbit milik sendiri (siswa lulus tetap boleh membaca). */
  "reportCards.self.read": { roles: ["STUDENT"], studentStatuses: ALL_STUDENT_STATUSES },
} as const satisfies Record<string, PolicyRule>;
