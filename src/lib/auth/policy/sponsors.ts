import { ALL_SPONSOR_STATUSES, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain sponsors. Status sponsor: PENDING boleh menyiapkan (profil), APPROVED penuh,
 * SUSPENDED hanya baca. Top-up hanya APPROVED.
 */
export const sponsorsPolicy = {
  /** Sponsor: profil, kartu saldo, ledger, riwayat top-up milik sendiri (semua status, termasuk ditangguhkan). */
  "sponsor.self.read": { roles: ["SPONSOR"], sponsorStatuses: ALL_SPONSOR_STATUSES },
  /** Sponsor: ubah profil kontak, batalkan top-up menunggu (bukan SUSPENDED). */
  "sponsor.self.write": { roles: ["SPONSOR"], sponsorStatuses: ["PENDING", "APPROVED"] },
  /** Sponsor: ajukan top-up saldo (hanya APPROVED). */
  "sponsor.topup": { roles: ["SPONSOR"], sponsorStatuses: ["APPROVED"] },
  /** Super admin: akun sponsor, status, ledger & penyesuaian, pengaturan platform iklan. */
  "sponsor.admin": { roles: ["SUPER_ADMIN"] },
  /** Super admin: verifikasi top-up. */
  "topup.review": { roles: ["SUPER_ADMIN"] },
} as const satisfies Record<string, PolicyRule>;
