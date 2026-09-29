"use client";
import { APP_ENVS, APP_ENV_ORDER, switchEnvUrl, type AppEnv } from "@/lib/frontend/app-env";

/**
 * Sakelar Produksi | Staging: membuka halaman yang sama di domain lingkungan lain. Akun, sesi, dan data
 * tiap lingkungan terpisah (database & cookie berbeda), jadi di sana perlu masuk lagi.
 * `env` dihitung server dari header Host (app/hub/layout.tsx) agar HTML awal sudah memuatnya (tanpa geser tata letak).
 */
export function EnvSwitch({ env, className = "" }: { env: AppEnv | null; className?: string }) {
  if (!env) return null;
  const info = APP_ENVS[env];
  return <div className={`env-switch ${className}`} data-env={env}>
    <div className="env-switch-track" role="group" aria-label="Pindah lingkungan aplikasi">
      {APP_ENV_ORDER.map(target => target === env
        ? <span key={target} className="env-option active" aria-current="true">{APP_ENVS[target].label}</span>
        : <a key={target} className="env-option" href={`${APP_ENVS[target].origin}/hub`}
          onClick={e => { e.preventDefault(); window.location.assign(switchEnvUrl(target, window.location)); }}>{APP_ENVS[target].label}</a>)}
    </div>
    <small>Sedang di {info.label.toLowerCase()} — {info.hint.toLowerCase()} Akun tiap lingkungan terpisah.</small>
  </div>;
}

/** Penanda mencolok di topbar khusus staging, agar tidak tertukar dengan produksi. */
export function EnvBadge({ env }: { env: AppEnv | null }) {
  return env === "staging" ? <span className="env-badge" title="Kamu sedang di staging: uji coba dengan data contoh.">Staging</span> : null;
}
