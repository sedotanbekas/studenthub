"use client";
import { useState, type FormEvent } from "react";
import { DEFAULT_APP_NAME, LOGO_MAX_INPUT_BYTES, LOGO_MIN_SIDE, normalizeAppName } from "@/lib/app-settings/rules";
import { api } from "@/lib/frontend/api";
import type { Module } from "@/lib/frontend/types";
import { BrandView, LogoView, useBranding, type Branding } from "../branding";
import { useHub } from "../context";
import { Icon } from "../icon";
import { Workspace } from "../workspace";

/**
 * "App Setting" (pemilik 2026-10-07): semua pengaturan platform dalam satu menu. Bagian atas = identitas aplikasi
 * (nama & logo, hak app.settings); bagian bawah = pengaturan iklan & absensi yang sudah ada (Workspace generik,
 * tiap tindakan tetap tersaring hak masing-masing). Mode demo: perubahan hanya untuk sesi ini.
 */
const OTHER_PATHS = ["/platform/settings", "/platform/attendance"];
const OTHER_ACTIONS = ["sponsor.admin", "attendance.reclose", "attendance.test_mode"];

export function AppSettingsPage({ module }: { module: Module }) {
  const { me, demo } = useHub();
  const canBrand = demo || me.permissions.includes("app.settings");
  const canOther = demo || OTHER_ACTIONS.some(action => me.permissions.includes(action));
  return <div className="workspace-page app-settings-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>Semua pengaturan aplikasi di satu tempat: identitas aplikasi, iklan & sponsor, serta penutupan absensi.</p></div></div>
    {canBrand && <IdentityPanel />}
    {canOther && <section className="app-settings-group" aria-labelledby="other-settings-title">
      <h2 id="other-settings-title" className="app-settings-subtitle">Iklan, sponsor & absensi</h2>
      <Workspace module={{ ...module, paths: OTHER_PATHS, primary: "getAdSettings" }} embedded />
    </section>}
  </div>;
}

type AppSettingsData = Branding & { readonly defaultAppName: string };

/** Simpan lewat API (atau lokal di mode demo), lalu perbarui identitas di seluruh kerangka hub. */
function useIdentityActions() {
  const { demo, toast } = useHub();
  const { branding, setBranding } = useBranding();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(task: () => Promise<Branding>, done: string) {
    setBusy(true); setError("");
    try { setBranding(await task()); toast(demo ? `${done} (mode demo, hanya untuk sesi ini).` : done); }
    catch (e) { setError(e instanceof Error ? e.message : "Pengaturan belum tersimpan."); }
    finally { setBusy(false); }
  }
  const remote = async (path: string, init: RequestInit): Promise<Branding> => {
    const data = (await api(path, init)).data as AppSettingsData;
    return { appName: data.appName, logoUrl: data.logoUrl };
  };
  return {
    busy, error, setError,
    saveName: (appName: string) => run(() => demo ? Promise.resolve({ ...branding, appName }) : remote("/platform/app-settings", { method: "PATCH", body: JSON.stringify({ appName }) }), "Nama aplikasi disimpan"),
    uploadLogo: (file: File) => run(() => {
      if (demo) return Promise.resolve({ ...branding, logoUrl: URL.createObjectURL(file) });
      const form = new FormData(); form.set("file", file);
      return remote("/platform/app-settings/logo", { method: "POST", body: form });
    }, "Logo aplikasi diganti"),
    removeLogo: () => run(() => demo ? Promise.resolve({ ...branding, logoUrl: null }) : remote("/platform/app-settings/logo", { method: "DELETE" }), "Logo dikembalikan ke bawaan"),
  };
}

function IdentityPanel() {
  const { branding } = useBranding();
  const actions = useIdentityActions();
  const [name, setName] = useState(branding.appName);
  const normalized = normalizeAppName(name);
  const dirty = normalized !== null && normalized !== branding.appName;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (normalized === null) { actions.setError("Nama aplikasi 2-40 karakter, tanpa tanda < >."); return; }
    void actions.saveName(normalized).then(() => setName(normalized));
  }
  function pick(file: File | undefined) {
    if (!file) return;
    if (file.size > LOGO_MAX_INPUT_BYTES) { actions.setError("Ukuran logo maksimal 2 MB."); return; }
    void actions.uploadLogo(file);
  }
  return <section className="panel app-identity" aria-labelledby="identity-title">
    <div className="panel-heading"><div><h2 id="identity-title">Identitas aplikasi</h2><p>Nama & logo tampil di sidebar, halaman masuk, layar pembuka, dan judul tab browser semua pengguna.</p></div></div>
    <div className="identity-preview" aria-label="Pratinjau logo & nama"><BrandView appName={normalized ?? branding.appName} logoUrl={branding.logoUrl} /></div>
    <div className="identity-grid">
      <form className="identity-block" onSubmit={submit}>
        <label className="field" htmlFor="app-name">Nama aplikasi<span className="field-hint">2-40 karakter. Kata terakhir tampil berwarna aksen.</span></label>
        <input id="app-name" value={name} maxLength={40} autoComplete="off" disabled={actions.busy} onChange={e => setName(e.target.value)} />
        <div className="theme-actions">
          <button type="button" className="button secondary small-button" disabled={actions.busy || name === DEFAULT_APP_NAME} onClick={() => setName(DEFAULT_APP_NAME)}><Icon name="refresh" size={15} />Nama bawaan</button>
          <button type="submit" className="button primary small-button" disabled={actions.busy || !dirty}><Icon name="check" size={16} />Simpan nama</button>
        </div>
      </form>
      <div className="identity-block">
        <span className="field">Logo<span className="field-hint">JPEG/PNG/WebP minimal {LOGO_MIN_SIDE}×{LOGO_MIN_SIDE} px, maks 2 MB. Sebaiknya persegi berlatar transparan. Dipakai juga untuk favicon, ikon aplikasi di HP, ikon notifikasi, dan animasi layar pembuka.</span></span>
        <div className="identity-logo-row">
          <span className="identity-logo-box"><LogoView logoUrl={branding.logoUrl} /></span>
          <label className={`button secondary small-button file-button${actions.busy ? " disabled" : ""}`}><Icon name="upload" size={15} />{branding.logoUrl ? "Ganti logo" : "Unggah logo"}<input type="file" accept="image/png,image/jpeg,image/webp" disabled={actions.busy} onChange={e => { pick(e.target.files?.[0]); e.target.value = ""; }} /></label>
          {branding.logoUrl && <button type="button" className="button danger-outline small-button" disabled={actions.busy} onClick={() => void actions.removeLogo()}>Pakai logo bawaan</button>}
        </div>
      </div>
    </div>
    {actions.error && <p className="error-message" role="alert">{actions.error}</p>}
  </section>;
}
