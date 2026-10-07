/**
 * Lingkungan aplikasi (produksi / staging) dikenali dari header Host — satu build, dua domain, sehingga
 * tidak perlu variabel env tambahan. Host tak dikenal (lokal, test) = null: sakelar lingkungan disembunyikan.
 */
export type AppEnv = "production" | "staging";

export interface AppEnvInfo {
  readonly label: string;
  readonly origin: string;
  readonly hint: string;
}

export const APP_ENVS: Readonly<Record<AppEnv, AppEnvInfo>> = {
  production: { label: "Produksi", origin: "https://studenthub.id", hint: "Data asli sekolah." },
  staging: { label: "Staging", origin: "https://staging.studenthub.id", hint: "Uji coba dengan data contoh." },
};

export const APP_ENV_ORDER: readonly AppEnv[] = ["production", "staging"];

/** Domain resmi + alias sslip.io (vhost lama yang masih hidup). */
const HOST_ENVS: Readonly<Record<string, AppEnv>> = {
  "studenthub.id": "production",
  "www.studenthub.id": "production",
  "studenthub.38.47.176.211.sslip.io": "production",
  "staging.studenthub.id": "staging",
  "studenthub-demo.38.47.176.211.sslip.io": "staging",
};

export function appEnvOfHost(host: string | null | undefined): AppEnv | null {
  const hostname = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  return HOST_ENVS[hostname] ?? null;
}

/** Halaman yang sama (path, query, hash) di lingkungan tujuan; origin selalu dari daftar tetap. */
export function switchEnvUrl(target: AppEnv, here: { readonly pathname: string; readonly search: string; readonly hash: string }): string {
  return `${APP_ENVS[target].origin}${here.pathname}${here.search}${here.hash}`;
}

/**
 * Sakelar lingkungan (keputusan pemilik 2026-09-30, klien mulai mencoba produksi): produksi bersih — hanya
 * super admin yang melihat jalan ke staging; staging selalu punya tombol "Kembali ke Produksi" (yang
 * sekaligus mengakhiri sesi staging, demo maupun akun). Lokal/test (env null) tanpa sakelar.
 */
export type EnvSwitchMode = "none" | "to-staging" | "back-to-production";

/**
 * Produksi tidak lagi menampilkan tautan ke staging (pemilik 2026-10-07: produksi bersih tanpa mode uji); staging
 * tetap punya tombol "Kembali ke Produksi". `role` dipertahankan untuk pemanggil lama.
 */
export function envSwitchMode(env: AppEnv | null, _role: string | null): EnvSwitchMode {
  return env === "staging" ? "back-to-production" : "none";
}

/** Mode demo (tombol persona di halaman masuk) hanya di luar produksi. */
export function demoAllowed(env: AppEnv | null): boolean {
  return env !== "production";
}
