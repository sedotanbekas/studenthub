/**
 * Tampilan "Masuk sebagai" di web (murni): sisa waktu banner dan alamat kembali ke layar super admin. Alamat kembali
 * disimpan di sessionStorage sebelum mulai; hanya alamat di dalam /hub yang dipakai (bukan open redirect).
 */
export const IMPERSONATION_RETURN_KEY = "studenthub_impersonation_return";
const FALLBACK_RETURN = "/hub/users";

export interface ImpersonationView {
  readonly by: { readonly id: string; readonly name: string };
  readonly expiresAt: string;
}

export function remainingMs(expiresAt: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAt) - nowMs);
}

export function remainingText(expiresAt: string, nowMs: number): string {
  // Dibulatkan ke atas seperti hitung mundur: "0:00" hanya saat benar-benar habis.
  const seconds = Math.ceil(remainingMs(expiresAt, nowMs) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function safeReturnPath(stored: string | null): string {
  if (!stored) return FALLBACK_RETURN;
  return stored === "/hub" || /^\/hub[/?#]/.test(stored) ? stored : FALLBACK_RETURN;
}

/** (Browser) alamat layar super admin yang tersimpan; sessionStorage diblokir -> halaman Pengguna. */
export function impersonationReturnPath(): string {
  try {
    return safeReturnPath(sessionStorage.getItem(IMPERSONATION_RETURN_KEY));
  } catch {
    return safeReturnPath(null);
  }
}

/** Header proxy web: sesi "Masuk sebagai" berakhir dan sesi super admin sudah dipulihkan (muat ulang ke sana). */
export const IMPERSONATION_ENDED_HEADER = "x-impersonation-ended";
