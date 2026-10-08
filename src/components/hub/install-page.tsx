"use client";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { currentDevice, registerAppWorker } from "@/lib/frontend/app-worker";
import { installPrompt } from "@/lib/frontend/install-prompt";
import { installIntro, installShareText, whatsappShareUrl, type InstallMode } from "@/lib/frontend/install-rules";
import { Icon } from "./icon";
import { INSTALL_FEEDBACK, InstallSteps, useInstallMode } from "./install";

/**
 * Halaman publik /pasang (tanpa login): tombol/langkah pasang sesuai HP pengunjung, kode QR & tautan bagikan untuk
 * sekolah (WhatsApp), serta langkah Android & iPhone untuk membantu orang lain. Isi bergantung perangkat dirender
 * setelah hidrasi (HTML server = kerangka).
 */
interface InstallPageProps { appName: string; iconUrl: string; qrSvg: string; pageUrl: string }

export function InstallPage({ appName, iconUrl, qrSvg, pageUrl }: InstallPageProps) {
  const mode = useInstallMode();
  useEffect(() => { void registerAppWorker(); }, []);
  // Dibuka dari ikon layar utama (iPhone bisa memakai halaman tempat ia dipasang sebagai halaman awal) -> ke aplikasi.
  useEffect(() => { if (mode === "installed" && currentDevice().standalone) window.location.replace("/hub"); }, [mode]);
  return <main className="install-page">
    <section className="panel install-hero">
      {/* eslint-disable-next-line @next/next/no-img-element -- ikon aplikasi (logo unggahan berversi), tanpa optimasi Next. */}
      <img className="install-app-icon" src={iconUrl} alt="" width={88} height={88} />
      <h1>Pasang {appName}</h1>
      <p className="install-lead">Absensi, rapor, tagihan, dan pengumuman sekolah — dibuka langsung dari layar utama HP seperti aplikasi biasa.</p>
      <InstallAction mode={mode} />
    </section>
    <ShareCard appName={appName} qrSvg={qrSvg} pageUrl={pageUrl} />
    <section className="panel install-guide">
      <h2>Langkah pasang</h2>
      <details><summary>Android (Chrome)</summary><InstallSteps mode="android-menu" /></details>
      <details><summary>iPhone dan iPad (Safari)</summary><InstallSteps mode="ios-safari" /></details>
    </section>
    <p className="install-footer"><Link className="text-link" href="/hub">Buka di browser saja</Link></p>
  </main>;
}

function InstallAction({ mode }: { mode: InstallMode | null }) {
  const [message, setMessage] = useState("");
  if (!mode) return <div className="install-action" aria-busy="true" />;
  async function install() {
    setMessage(INSTALL_FEEDBACK[await installPrompt.prompt()]);
  }
  return <div className="install-action">
    <p className="install-intro">{installIntro(mode)}</p>
    {mode === "installed" && <Link className="button primary large" href="/hub">Buka aplikasi<Icon name="arrow" size={20} /></Link>}
    {mode === "prompt" && <button type="button" className="button primary large" onClick={() => void install()}><Icon name="download" size={20} />Pasang sekarang</button>}
    <InstallSteps mode={mode} />
    {message && <p className="install-message" role="status">{message}</p>}
  </div>;
}

const noSubscription = () => () => {};

function ShareCard({ appName, qrSvg, pageUrl }: Omit<InstallPageProps, "iconUrl">) {
  const [copied, setCopied] = useState(false);
  const canShare = useSyncExternalStore(noSubscription, () => typeof navigator.share === "function", () => false);
  const text = installShareText(appName, pageUrl);
  async function share() {
    try { await navigator.share({ title: `Pasang ${appName}`, text, url: pageUrl }); } catch { /* dibatalkan pengguna */ }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(pageUrl); setCopied(true); } catch { setCopied(false); }
  }
  return <section className="panel install-share">
    {/* SVG dibuat server dari APP_ORIGIN (src/lib/install/qr.ts), bukan dari masukan pengguna. */}
    <div className="install-qr" role="img" aria-label={`Kode QR menuju ${pageUrl}`} dangerouslySetInnerHTML={{ __html: qrSvg }} />
    <div className="install-share-body">
      <h2>Bagikan ke orang tua &amp; siswa</h2>
      <p className="install-intro">Pindai kode QR ini dengan kamera HP, atau kirim tautannya.</p>
      <div className="install-share-actions">
        <a className="button primary small-button" href={whatsappShareUrl(text)} target="_blank" rel="noopener noreferrer">Kirim lewat WhatsApp</a>
        {canShare && <button type="button" className="button secondary small-button" onClick={() => void share()}>Bagikan…</button>}
        <button type="button" className="button secondary small-button" onClick={() => void copy()}><Icon name="copy" size={15} />{copied ? "Tautan disalin" : "Salin tautan"}</button>
      </div>
      <code className="install-url">{pageUrl}</code>
    </div>
  </section>;
}
