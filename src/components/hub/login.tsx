"use client";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/frontend/api";
import { loginDeviceId } from "@/lib/frontend/attendance";
import { DEMO_PERSONAS } from "@/lib/frontend/demo-personas";
import { Brand, Icon } from "./icon";

export function Login({ onLogin, onDemo }: { onLogin: () => Promise<void>; onDemo: (personaKey: string) => void }) {
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
      await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier, password: values.get("password"), platform: "WEB", deviceName: "Student Hub Web", ...(deviceId ? { deviceId } : {}), ...(totp ? { totpCode: values.get("totpCode") } : {}) }) });
      await onLogin();
    } catch (e) { if (e instanceof ApiError && ["TOTP_REQUIRED", "TOTP_INVALID"].includes(e.code)) setTotp(true); setError(e instanceof Error ? e.message : "Gagal masuk."); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story" aria-hidden="true"><Brand /><div><h1>Sekolah dan siswa, dalam satu tempat.</h1><p>Absensi, rapor, tagihan, dan pengumuman sekolah.</p></div></section>
    <section className="login-form-side"><div className="login-box"><span className="login-brand"><Brand /></span><h2>Senang bertemu lagi.</h2><p>Masuk dengan NISN (siswa) atau email (admin & sponsor).</p><form onSubmit={submit}>
      <label className="field">NISN atau email<input name="identifier" autoComplete="username" inputMode="email" placeholder="10 digit NISN atau nama@sekolah.sch.id" required autoFocus /></label>
      <label className="field">Kata sandi<span className="password-input"><input name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Masukkan kata sandi" required /><button type="button" aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} onClick={() => setVisible(!visible)}><Icon name="eye" size={20} /></button></span></label>
      {totp && <label className="field">Kode autentikator<input name="totpCode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 digit kode verifikasi" autoComplete="one-time-code" required /></label>}
      {error && <div className="error-message" role="alert">{error}</div>}<button className="button primary block large" disabled={busy}>{busy ? "Sedang masuk…" : "Masuk"}<Icon name="arrow" size={20} /></button>
    </form><p className="login-help">Lupa kata sandi? Hubungi admin sekolah untuk mengatur ulang.</p><DemoPicker onDemo={onDemo} /></div></section>
  </main>;
}

const PERSONA_ICONS: Record<string, string> = { SCHOOL_ADMIN: "school", STUDENT: "users", SPONSOR: "heart", SUPER_ADMIN: "shield" };

/** Masuk demo sekali klik (tanpa kata sandi, data contoh di browser). */
function DemoPicker({ onDemo }: { onDemo: (personaKey: string) => void }) {
  return <section className="demo-picker" aria-labelledby="demo-title"><h3 id="demo-title">Coba tanpa login <small>mode demo · data contoh</small></h3>
    <div className="demo-grid">{DEMO_PERSONAS.map(p => <button key={p.key} type="button" className="demo-persona" aria-label={`Masuk demo sebagai ${p.label}`} onClick={() => onDemo(p.key)}><span className="demo-icon"><Icon name={PERSONA_ICONS[p.identity.user.role] ?? "users"} size={20} /></span><span><strong>{p.label}</strong><small>{p.caption}</small></span></button>)}</div>
  </section>;
}
