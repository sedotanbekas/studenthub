import { ADMINS, type PolicyRule } from "./types";

/**
 * Aksi POLICY domain SPP. Siswa LULUS tetap boleh membaca tagihan & kuitansi serta melunasi tunggakan
 * (unggah/batalkan bukti transfer); siswa berstatus lain ditolak STUDENT_NOT_ACTIVE.
 */
export const billingPolicy = {
  /** Admin: daftar & detail tagihan, antrean bukti transfer, kuitansi. */
  "billing.read": { roles: ADMINS },
  /** Admin: buat (tunggal/massal), ubah, batalkan, pulihkan tagihan. */
  "billing.write": { roles: ADMINS },
  /** Admin: setujui/tolak bukti transfer, catat pembayaran tunai, batalkan pembayaran. */
  "billing.verify": { roles: ADMINS },
  /** Siswa: tagihan, kuitansi, dan rekening SPP milik sendiri. */
  "billing.self.read": { roles: ["STUDENT"], studentStatuses: ["ACTIVE", "GRADUATED"] },
  /** Siswa: unggah & batalkan bukti transfer (tunggakan siswa lulus tetap bisa dilunasi). */
  "billing.self.pay": { roles: ["STUDENT"], studentStatuses: ["ACTIVE", "GRADUATED"] },
} as const satisfies Record<string, PolicyRule>;
