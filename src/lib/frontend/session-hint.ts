/**
 * Petunjuk sesi untuk render server halaman hub. Cookie token (`studenthub_access/refresh`) ber-Path
 * /api/web sehingga tidak terkirim ke /hub; cookie PENANDA ini (Path=/, tanpa rahasia) hanya memberi
 * tahu server tampilan awal: tanpa penanda -> halaman masuk langsung ada di HTML (tanpa menunggu JS &
 * GET /auth/me), ada penanda -> "Memuat…" sampai sesi dipulihkan di browser. Bukan otorisasi: data
 * tetap hanya bisa diambil dengan token.
 * - SESSION_HINT: dipasang/dihapus proxy /api/web bersama token akun (src/app/api/web/[...path]/route.ts).
 * - DEMO_HINT: cookie sesi browser yang dipasang saat masuk mode demo (persona di sessionStorage).
 */
export const SESSION_HINT = "studenthub_session";
export const DEMO_HINT = "studenthub_demo";

export interface SessionHint { readonly account: boolean; readonly demo: boolean }

export function readSessionHint(get: (name: string) => string | undefined): SessionHint {
  return { account: get(SESSION_HINT) === "1", demo: get(DEMO_HINT) === "1" };
}

/** Tampilan pertama kerangka hub (server & hidrasi harus sama). */
export function initialSessionView(hint: SessionHint): "login" | "loading" {
  return hint.account || hint.demo ? "loading" : "login";
}

/** Nilai document.cookie penanda demo: tanpa Max-Age (hilang saat browser ditutup), Max-Age=0 = hapus. */
export function demoHintCookie(on: boolean, secure: boolean): string {
  const value = on ? `${DEMO_HINT}=1; Path=/` : `${DEMO_HINT}=; Path=/; Max-Age=0`;
  return `${value}; SameSite=Lax${secure ? "; Secure" : ""}`;
}
