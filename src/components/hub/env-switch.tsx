"use client";
import { useState } from "react";
import { APP_ENVS, envSwitchMode, switchEnvUrl, type AppEnv } from "@/lib/frontend/app-env";
import type { Role } from "@/lib/frontend/types";
import { Icon } from "./icon";
import { leaveEnvironment } from "./use-session";

/**
 * Jalan antarlingkungan (aturan: envSwitchMode di src/lib/frontend/app-env.ts). Produksi bersih untuk klien:
 * hanya super admin yang melihat tautan ke staging. Staging selalu punya tombol "Kembali ke Produksi" yang
 * sekaligus MENGAKHIRI sesi staging (demo maupun akun). Akun, sesi, dan data tiap lingkungan terpisah.
 * `env` dihitung server dari header Host (app/hub/layout.tsx) agar HTML awal sudah memuatnya (tanpa geser tata letak).
 */
export function EnvSwitch({ env, role = null, className = "" }: { env: AppEnv | null; role?: Role | null; className?: string }) {
  const mode = envSwitchMode(env, role);
  const [leaving, setLeaving] = useState(false);
  if (mode === "none") return null;
  if (mode === "to-staging") {
    return <div className={`env-switch ${className}`} data-env="production">
      <a className="env-link" href={`${APP_ENVS.staging.origin}/hub`} onClick={e => { e.preventDefault(); window.location.assign(switchEnvUrl("staging", window.location)); }}>Buka staging (uji coba)<Icon name="arrow" size={15} /></a>
      <small>Hanya terlihat oleh super admin. Akun staging terpisah.</small>
    </div>;
  }
  async function backToProduction() {
    setLeaving(true);
    await leaveEnvironment();
    window.location.assign(switchEnvUrl("production", window.location));
  }
  return <div className={`env-switch ${className}`} data-env="staging">
    <small>Kamu di <strong>STAGING</strong> — uji coba dengan data contoh.</small>
    <button type="button" className="env-back" disabled={leaving} onClick={() => void backToProduction()}><Icon name="back" size={16} />{leaving ? "Keluar dari staging…" : "Kembali ke Produksi"}</button>
    <small>Kembali ke produksi sekaligus keluar dari staging.</small>
  </div>;
}

/** Penanda mencolok di topbar khusus staging, agar tidak tertukar dengan produksi. */
export function EnvBadge({ env }: { env: AppEnv | null }) {
  return env === "staging" ? <span className="env-badge" title="Kamu sedang di staging: uji coba dengan data contoh.">Staging</span> : null;
}
