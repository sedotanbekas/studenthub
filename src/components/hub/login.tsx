"use client";
import { Suspense, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { api, ApiError } from "@/lib/frontend/api";
import { loginDeviceId } from "@/lib/frontend/attendance";
import { DEMO_PERSONAS } from "@/lib/frontend/demo-personas";
import type { AppEnv } from "@/lib/frontend/app-env";
import { EARLY_DEMO, takeEarlyDemo } from "@/lib/frontend/early-demo";
import { EnvSwitch } from "./env-switch";
import { Brand, Icon } from "./icon";
import { loadSections } from "./sections";
import { cancelSplash, centerOf, playLoginSplash } from "./splash";

const noSubscription = () => () => {};
const earlyStore = () => window as unknown as Record<string, unknown>;
const PERSONA_KEYS = DEMO_PERSONAS.map(p => p.key);
/** false di HTML server & saat hidrasi, true setelahnya. */
function useHydrated(): boolean {
  return useSyncExternalStore(noSubscription, () => true, () => false);
}

/**
 * Halaman masuk — dirender server untuk pengunjung tanpa sesi. Sebelum JS aktif tombol Masuk belum
 * bertipe submit (form dengan 2 isian tanpa tombol submit tidak terkirim lewat Enter), jadi kredensial
 * tidak pernah terkirim sebagai form biasa; method="post" = pengaman bila browser tetap mengirimnya.
 */
interface LoginProps { env: AppEnv | null; onLogin: (covered: Promise<void>) => Promise<void>; onDemo: (personaKey: string, covered: Promise<void>) => void }
export function Login({ env, onLogin, onDemo }: LoginProps) {
  const hydrated = useHydrated();
  // Tombol demo yang diketuk sebelum JS aktif (dicatat skrip sebaris, src/lib/frontend/early-demo.ts).
  useEffect(() => {
    const key = takeEarlyDemo(earlyStore(), PERSONA_KEYS);
    if (key) onDemo(key, playLoginSplash(centerOf(document.querySelector(`[${EARLY_DEMO.attribute}="${key}"]`))));
  }, [onDemo]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [totp, setTotp] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    const identifier = String(values.get("identifier") ?? "");
    // Siswa (NISN) dari browser HP mendaftarkan HP ini sebagai perangkat absen.
    const deviceId = loginDeviceId(identifier, navigator.userAgent, localStorage, () => crypto.randomUUID());
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password: values.get("password"), platform: "WEB", deviceName: "studenthub.id Web", ...(deviceId ? { deviceId } : {}), ...(totp ? { totpCode: values.get("totpCode") } : {}) }) });
      // Tirai splash melingkar dari tombol Masuk; beranda disingkap masker logo setelah identitas dimuat.
      await onLogin(playLoginSplash(centerOf((event.nativeEvent as SubmitEvent).submitter)));
    } catch (e) { cancelSplash(); if (e instanceof ApiError && ["TOTP_REQUIRED", "TOTP_INVALID"].includes(e.code)) setTotp(true); setError(e instanceof Error ? e.message : "Gagal masuk."); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story" aria-hidden="true"><Brand /><div><h1>Sekolah dan siswa, dalam satu tempat.</h1><p>Absensi, rapor, tagihan, dan pengumuman sekolah.</p></div></section>
    <section className="login-form-side"><div className="login-box"><span className="login-brand"><Brand /></span><h2>Senang bertemu lagi.</h2><p>Masuk dengan NISN (siswa) atau email (admin & sponsor).</p><form method="post" onSubmit={submit} onInput={() => void loadSections()}>
      <label className="field">NISN atau email<input name="identifier" autoComplete="username" inputMode="email" placeholder="10 digit NISN atau nama@sekolah.sch.id" required autoFocus /></label>
      <label className="field">Kata sandi<span className="password-input"><input name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Masukkan kata sandi" required /><button type="button" aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} onClick={() => setVisible(!visible)}><Icon name="eye" size={20} /></button></span></label>
      {totp && <label className="field">Kode autentikator<input name="totpCode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 digit kode verifikasi" autoComplete="one-time-code" required onChange={e => { e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "").slice(0, 6); }} /></label>}
      {error && <div className="error-message" role="alert">{error}</div>}<button type={hydrated ? "submit" : "button"} className="button primary block large" disabled={busy}>{busy ? "Sedang masuk…" : "Masuk"}<Icon name="arrow" size={20} /></button>
    </form><p className="login-help">Lupa kata sandi? Hubungi admin sekolah untuk mengatur ulang.</p><Suspense fallback={null}><DemoPicker onDemo={onDemo} /></Suspense><EnvSwitch env={env} className="login-env" /></div></section>
  </main>;
}

const PERSONA_ICONS: Record<string, string> = { SCHOOL_ADMIN: "school", STUDENT: "users", SPONSOR: "heart", SUPER_ADMIN: "shield" };

/** Masuk demo sekali klik (tanpa kata sandi, data contoh di browser). */
function DemoPicker({ onDemo }: { onDemo: (personaKey: string, covered: Promise<void>) => void }) {
  // Niat memilih demo (arahkan/sentuh/fokus) = mulai unduh isi bagian hub, sebelum tirai dimulai.
  const warm = () => void loadSections();
  return <section className="demo-picker" aria-labelledby="demo-title" onPointerEnter={warm} onFocus={warm}><h3 id="demo-title">Coba tanpa login <small>mode demo · data contoh</small></h3>
    <div className="demo-grid">{DEMO_PERSONAS.map(p => <button key={p.key} type="button" className="demo-persona" aria-label={`Masuk demo sebagai ${p.label}`} {...{ [EARLY_DEMO.attribute]: p.key }} onClick={e => { takeEarlyDemo(earlyStore(), []); onDemo(p.key, playLoginSplash(centerOf(e.currentTarget))); }}><span className="demo-icon"><Icon name={PERSONA_ICONS[p.identity.user.role] ?? "users"} size={20} /></span><span><strong>{p.label}</strong><small>{p.caption}</small></span></button>)}</div>
  </section>;
}
