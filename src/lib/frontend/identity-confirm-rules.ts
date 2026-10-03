import { NISN_PATTERN } from "@/lib/students/constants";

/**
 * Konfirmasi identitas sebelum absen (A2, keputusan pemilik 2026-10-03): kartu "Absen sebagai …" dan pesan
 * halaman masuk setelah "Bukan saya". Murni (tanpa React). NISN utuh tidak pernah ditampilkan.
 */
export const NISN_MASK = "••••";
export const NISN_VISIBLE_DIGITS = 4;

export interface IdentityFacts {
  readonly className: string | null;
  readonly maskedNisn: string | null;
  /** 4 digit terakhir untuk label pembaca layar ("NISN berakhiran 5432"). */
  readonly nisnTail: string | null;
}
export const EMPTY_FACTS: IdentityFacts = Object.freeze({ className: null, maskedNisn: null, nisnTail: null });

export type LogoutReason = "NOT_ME";
export interface LoginNotice {
  readonly title: string;
  readonly note: string;
}

export const NOT_ME_NOTICE: LoginNotice = {
  title: "Akun sebelumnya sudah keluar dari perangkat ini.",
  note: "Sebaiknya absen dari HP-mu sendiri. Masuk di sini mengeluarkan akunmu dari HP-mu, dan absen dua siswa dari HP yang sama di hari yang sama ditandai untuk diperiksa admin sekolah.",
};
/** "Bukan saya" saat offline: cookie sesi server belum terhapus, akun bisa kembali saat dimuat ulang. */
export const OFFLINE_NOTICE: LoginNotice = {
  title: "Akun belum keluar sepenuhnya.",
  note: "Perangkat ini belum tersambung ke server. Sambungkan internet lalu muat ulang halaman ini agar akun sebelumnya benar-benar keluar.",
};

const tailOf = (nisn: unknown): string | null => {
  if (typeof nisn !== "string") return null;
  const value = nisn.trim();
  return NISN_PATTERN.test(value) ? value.slice(-NISN_VISIBLE_DIGITS) : null;
};

/** NISN 10 digit -> "••••" + 4 digit terakhir; selain itu null. */
export function maskNisn(nisn: unknown): string | null {
  const tail = tailOf(nisn);
  return tail === null ? null : `${NISN_MASK}${tail}`;
}

/** Kelas & NISN tersamar dari GET /student/profile (atau data demo); bentuk tak dikenal -> EMPTY_FACTS. */
export function identityFacts(profile: unknown): IdentityFacts {
  if (profile === null || typeof profile !== "object" || Array.isArray(profile)) return EMPTY_FACTS;
  const row = profile as { className?: unknown; nisn?: unknown };
  const className = typeof row.className === "string" && row.className.trim() !== "" ? row.className.trim() : null;
  const tail = tailOf(row.nisn);
  return { className, maskedNisn: tail === null ? null : `${NISN_MASK}${tail}`, nisnTail: tail };
}

/** Teks kartu: nama dirapikan + baris fakta "X IPA 1 · NISN ••••5432" + versi lisan untuk pembaca layar. */
export function identityCard(name: string, facts: IdentityFacts): { readonly name: string; readonly facts: string; readonly spoken: string } {
  const shown = [facts.className, facts.maskedNisn && `NISN ${facts.maskedNisn}`].filter(Boolean).join(" · ");
  const spoken = [facts.className, facts.nisnTail && `NISN berakhiran ${facts.nisnTail}`].filter(Boolean).join(", ");
  return { name: name.trim(), facts: shown, spoken };
}

/** Pesan halaman masuk setelah keluar; tanpa alasan -> null. `ended=false` = sesi server belum tentu berakhir. */
export function logoutNotice(reason: LogoutReason | undefined, ended: boolean): LoginNotice | null {
  if (reason !== "NOT_ME") return null;
  return ended ? NOT_ME_NOTICE : OFFLINE_NOTICE;
}

export type LoginNoticeEvent =
  | { readonly kind: "LOGIN" }
  | { readonly kind: "DEMO" }
  | { readonly kind: "EXPIRED" }
  | { readonly kind: "LOGOUT"; readonly reason?: LogoutReason; readonly ended: boolean };

/** Transisi pesan halaman masuk: hanya "Bukan saya" yang mengisi; masuk, demo, keluar biasa, sesi berakhir mengosongkan. */
export function nextLoginNotice(_current: LoginNotice | null, event: LoginNoticeEvent): LoginNotice | null {
  return event.kind === "LOGOUT" ? logoutNotice(event.reason, event.ended) : null;
}
