import { REFRESH_RACE_WAIT_MS, afterRefresh } from "./badge-poll-rules";
import type { Envelope } from "./types";
export class ApiError extends Error {
  constructor(message: string, public code: string, public details?: unknown) { super(message); }
}
let refresh: Promise<Response> | null = null;
/** Satu penyegaran sesi untuk semua permintaan yang bersamaan dalam tab ini. */
const sharedRefresh = (): Promise<Response> => (refresh ??= fetch("/api/web/auth/refresh", { method: "POST" }).finally(() => { refresh = null; }));
const abortError = () => new DOMException("Permintaan dibatalkan.", "AbortError");
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export interface ApiFetchOptions {
  /** Permintaan latar (poller badge): sesi yang berakhir TIDAK memicu "Sesi berakhir"; aksi pengguna berikutnya yang menangani. */
  readonly background?: boolean;
}

/**
 * fetch ke API web dengan penyegaran sesi saat 401 (dipakai api() dan unduhan berkas). Refresh 409 (tab lain sedang
 * memutar token) -> tunggu sebentar lalu ulangi; masih 401 -> refresh sekali lagi; baru setelah itu sesi berakhir.
 * Permintaan yang dibatalkan selagi menunggu refresh dilempar sebagai AbortError tanpa event apa pun.
 */
export async function apiFetch(path: string, init: RequestInit = {}, options: ApiFetchOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const send = () => fetch(`/api/web${path}`, { ...init, headers, cache: "no-store" });
  const response = await send();
  if (response.status !== 401 || ["/auth/login", "/auth/refresh"].includes(path)) return response;
  const recovered = await recoverSession(send, init.signal ?? null);
  if (recovered) return recovered;
  if (path !== "/auth/me" && !options.background) window.dispatchEvent(new Event("studenthub:expired"));
  return response;
}

/** Segarkan sesi lalu ulangi permintaan; null = sesi benar-benar berakhir. */
async function recoverSession(send: () => Promise<Response>, signal: AbortSignal | null): Promise<Response | null> {
  const check = () => { if (signal?.aborted) throw abortError(); };
  let outcome = afterRefresh((await sharedRefresh()).status);
  check();
  if (outcome === "wait-retry") {
    await pause(REFRESH_RACE_WAIT_MS);
    check();
    const again = await send();
    if (again.status !== 401) return again;
    outcome = afterRefresh((await sharedRefresh()).status);
    check();
  }
  return outcome === "retry" ? send() : null;
}
/** Unduh berkas dari API web (mis. templat impor) dengan sesi saat ini. */
export async function downloadApiFile(path: string, filename: string): Promise<void> {
  const response = await apiFetch(path);
  if (!response.ok) {
    // Galat server ber-envelope JSON (mis. 422 RECAP_TOO_LARGE, 429): tampilkan pesannya, bukan pesan umum.
    const body = (response.headers.get("content-type")?.includes("json") ? await response.json().catch(() => null) : null) as Envelope | null;
    throw new ApiError(body?.error?.message ?? "Berkas belum dapat diunduh. Coba lagi sebentar lagi.", body?.error?.code ?? "DOWNLOAD_FAILED");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function api(path: string, init: RequestInit = {}): Promise<Envelope> {
  const response = await apiFetch(path, init);
  const result = await response.json().catch(() => ({ success: false, error: { message: "Server belum dapat dihubungi. Silakan coba lagi.", code: "NETWORK" } })) as Envelope;
  if (!response.ok || !result.success) throw new ApiError(result.error?.message ?? "Permintaan gagal.", result.error?.code ?? "UNKNOWN", result.error?.details);
  return result;
}
export function scoped(path: string, schoolId: string) {
  return schoolId && path.startsWith("/school/") ? `${path}${path.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}` : path;
}
