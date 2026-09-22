"use client";
import { useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/frontend/api";
import { Brand, Icon } from "./icon";

export function Login({ onLogin, onDemo }: { onLogin: () => Promise<void>; onDemo: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [totp, setTotp] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ identifier: values.get("identifier"), password: values.get("password"), platform: "WEB", deviceName: "Student Hub Web", ...(totp ? { totpCode: values.get("totpCode") } : {}) }) });
      await onLogin();
    } catch (e) { if (e instanceof ApiError && ["TOTP_REQUIRED", "TOTP_INVALID"].includes(e.code)) setTotp(true); setError(e instanceof Error ? e.message : "Gagal masuk."); }
    finally { setBusy(false); }
  }
  return <main className="login-page">
    <section className="login-story"><Brand /><div className="story-content"><span className="eyebrow"><span className="live-dot" /> TERHUBUNG. BERTUMBUH. BERSAMA.</span><h1>Hal besar dimulai<br />dari <em>ruang yang baik.</em></h1><p>Satu tempat untuk menghubungkan sekolah,<br />mendampingi siswa, dan merayakan kemajuan.</p><SchoolArt /><div className="story-note"><span className="tiny-avatars"><b>A</b><b>N</b><b>R</b></span><span>Dibuat untuk sekolah.<br /><strong>Dirancang untuk manusia.</strong></span></div></div><footer>Ruang untuk belajar. Ruang untuk tumbuh. <Icon name="spark" size={17} /></footer></section>
    <section className="login-form-side"><div className="login-top">Sederhanakan hari sekolahmu <Icon name="sun" size={18} /></div><div className="login-box"><span className="welcome-icon"><Icon name="leaf" size={25} /></span><span className="eyebrow">SELAMAT DATANG DI STUDENT HUB</span><h2>Senang bertemu lagi.</h2><p>Masuk dan lanjutkan hal baik hari ini.</p><form onSubmit={submit}>
      <label className="field">Email atau NISN<input name="identifier" autoComplete="username" placeholder="nama@sekolah.sch.id atau NISN" required autoFocus /></label>
      <label className="field">Kata sandi<span className="password-input"><input name="password" type={visible ? "text" : "password"} autoComplete="current-password" placeholder="Masukkan kata sandi" required /><button type="button" aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"} onClick={() => setVisible(!visible)}><Icon name="eye" size={19} /></button></span></label>
      {totp && <label className="field">Kode autentikator<input name="totpCode" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} placeholder="6 digit kode verifikasi" autoComplete="one-time-code" required /></label>}
      {error && <div className="error-message" role="alert">{error}</div>}<button className="button primary login-submit" disabled={busy}>{busy ? "Sedang masuk…" : "Masuk ke ruang saya"}<Icon name="arrow" size={19} /></button>
    </form><p className="login-help">Lupa kata sandi? Hubungi admin sekolah atau<br />pengelola akun untuk membantu mengatur ulang.</p><div className="login-divider"><span>KENALI RUANG BARUMU</span></div><button className="button demo-button" onClick={onDemo}><Icon name="grid" size={18} /> Jelajahi tampilan demo <Icon name="arrow" size={17} /></button><p className="demo-caption">Tanpa login · Menggunakan data contoh</p></div><footer><Icon name="shield" size={15} /> Ruang yang aman untuk komunitas sekolahmu.</footer></section>
  </main>;
}
export function SchoolArt() {
  return <div className="school-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-sun"><Icon name="sun" size={35} /></div><div className="art-note"><span><Icon name="check" size={16} /> Hadir untuk masa depan</span><div className="art-note-lines"><i /><i /></div></div><div className="art-building"><div className="building-roof" /><span className="building-sign">STUDENT HUB</span><div className="building-windows">{Array.from({ length: 6 }, (_, i) => <i key={i} />)}</div><div className="building-door" /></div><div className="art-tree tree-one"><i /><b /></div><div className="art-tree tree-two"><i /><b /></div><div className="art-ground" /><div className="art-sticker"><Icon name="spark" size={17} /> Setiap langkah berarti.</div></div>;
}
