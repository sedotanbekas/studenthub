import { ALL_SPONSOR_STATUSES, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain ads. PENDING boleh menyiapkan draft & banner; hanya APPROVED yang bisa submit /
 * melanjutkan iklan; SUSPENDED hanya baca (daftar, detail, analitik). Siswa: hanya ACTIVE.
 */
export const adsPolicy = {
  /** Sponsor: daftar & detail iklan milik sendiri (semua status). */
  "ads.own.read": { roles: ["SPONSOR"], sponsorStatuses: ALL_SPONSOR_STATUSES },
  /** Sponsor: unggah banner, buat/ubah/hapus draft, tarik pengajuan, jeda, arsipkan (bukan SUSPENDED). */
  "ads.own.write": { roles: ["SPONSOR"], sponsorStatuses: ["PENDING", "APPROVED"] },
  /** Sponsor: ajukan review & lanjutkan tayang (hanya APPROVED). */
  "ads.own.submit": { roles: ["SPONSOR"], sponsorStatuses: ["APPROVED"] },
  /** Sponsor & super admin: pemilih sekolah untuk target iklan. */
  "ads.targeting.read": { roles: ["SPONSOR", "SUPER_ADMIN"], sponsorStatuses: ["PENDING", "APPROVED"] },
  /** Sponsor (miliknya, semua status) & super admin (wajib sponsorId): analitik iklan. */
  "ads.analytics.read": { roles: ["SPONSOR", "SUPER_ADMIN"], sponsorStatuses: ALL_SPONSOR_STATUSES },
  /** Super admin: antrean review, setujui/tolak, turunkan (takedown), daftar iklan platform. */
  "ads.review": { roles: ["SUPER_ADMIN"] },
  /** Siswa ACTIVE: slider iklan. */
  "ads.serve": { roles: ["STUDENT"] },
  /** Siswa ACTIVE: laporan impresi & klik. */
  "ads.event": { roles: ["STUDENT"] },
} as const satisfies Record<string, PolicyRule>;
