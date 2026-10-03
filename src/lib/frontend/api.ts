import type { Envelope } from "./types";
export class ApiError extends Error {
  constructor(message: string, public code: string, public details?: unknown) { super(message); }
}
let refresh: Promise<Response> | null = null;
/** fetch ke API web dengan satu kali penyegaran sesi saat 401 (dipakai api() dan unduhan berkas). */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/web${path}`, { ...init, headers, cache: "no-store" });
  if (response.status !== 401 || ["/auth/login", "/auth/refresh"].includes(path)) return response;
  refresh ??= fetch("/api/web/auth/refresh", { method: "POST" }).finally(() => { refresh = null; });
  if ((await refresh).ok) return fetch(`/api/web${path}`, { ...init, headers, cache: "no-store" });
  if (path !== "/auth/me") window.dispatchEvent(new Event("studenthub:expired"));
  return response;
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
