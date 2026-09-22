import type { Envelope } from "./types";
export class ApiError extends Error {
  constructor(message: string, public code: string, public details?: unknown) { super(message); }
}
let refresh: Promise<Response> | null = null;
export async function api(path: string, init: RequestInit = {}): Promise<Envelope> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  let response = await fetch(`/api/web${path}`, { ...init, headers, cache: "no-store" });
  if (response.status === 401 && !["/auth/login", "/auth/refresh"].includes(path)) {
    refresh ??= fetch("/api/web/auth/refresh", { method: "POST" }).finally(() => { refresh = null; });
    if ((await refresh).ok) response = await fetch(`/api/web${path}`, { ...init, headers, cache: "no-store" });
    else if (path !== "/auth/me") window.dispatchEvent(new Event("studenthub:expired"));
  }
  const result = await response.json().catch(() => ({ success: false, error: { message: "Server belum dapat dihubungi. Silakan coba lagi.", code: "NETWORK" } })) as Envelope;
  if (!response.ok || !result.success) throw new ApiError(result.error?.message ?? "Permintaan gagal.", result.error?.code ?? "UNKNOWN", result.error?.details);
  return result;
}
export function scoped(path: string, schoolId: string) {
  return schoolId && path.startsWith("/school/") ? `${path}${path.includes("?") ? "&" : "?"}schoolId=${encodeURIComponent(schoolId)}` : path;
}
