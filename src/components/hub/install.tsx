"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { currentDevice } from "@/lib/frontend/app-worker";
import { installPrompt, type PromptOutcome } from "@/lib/frontend/install-prompt";
import { INSTALL_DEFER_DAYS, INSTALLED_DEFER_DAYS, installDeferValue, installIntro, installModeOf, installSheetDelayMs, installSheetOf, installSteps, menuInstallVisible, type InstallMode, type InstallSheetMode } from "@/lib/frontend/install-rules";
import { isPromptDeferred } from "@/lib/frontend/web-push-rules";
import { useHub } from "./context";
import { Icon } from "./icon";

/**
 * Pasang aplikasi (PWA, keputusan pemilik 2026-10-08): lembar ajakan di beranda HP, item menu, tautan di halaman
 * masuk, dan halaman publik /pasang. Android/Chromium memakai tawaran pasang browser; iPhone dipandu lewat Bagikan.
 */

const noSubscription = () => () => {};
const DEFER_KEY = "studenthub_install_later";

export const INSTALL_FEEDBACK: Readonly<Record<PromptOutcome, string>> = {
  accepted: "Aplikasi sedang dipasang. Ikonnya muncul di layar utama.",
  dismissed: "Pemasangan dibatalkan. Bisa dipasang kapan saja dari menu.",
  unavailable: "Browser belum siap memasang. Ikuti langkah lewat menu browser.",
};

/** Mode pasang perangkat ini; null di HTML server & saat hidrasi (isi server dan klien tetap sama). */
export function useInstallMode(): InstallMode | null {
  const prompt = useSyncExternalStore(installPrompt.subscribe, installPrompt.getSnapshot, () => "none" as const);
  const hydrated = useSyncExternalStore(noSubscription, () => true, () => false);
  if (!hydrated) return null;
  return installModeOf({ ua: navigator.userAgent, device: currentDevice(), canPrompt: prompt === "ready", installed: prompt === "installed" });
}

export function InstallSteps({ mode }: { mode: InstallMode }) {
  const steps = installSteps(mode);
  return steps.length ? <ol className="push-steps install-steps">{steps.map(step => <li key={step}>{step}</li>)}</ol> : null;
}

function readDeferred(): boolean {
  try { return isPromptDeferred(localStorage.getItem(DEFER_KEY), Date.now()); } catch { return false; }
}

function defer(days: number): void {
  try { localStorage.setItem(DEFER_KEY, installDeferValue(Date.now(), days)); } catch { /* penyimpanan diblokir */ }
}

type SheetPhase = "wait" | InstallSheetMode | "none" | "closed";

interface InstallSheetProps { demo: boolean; restricted: boolean; home: boolean; toast: (text: string) => void; fallback: ReactNode }

/**
 * Lembar ajakan pasang di beranda HP. Tidak tampil -> `fallback` (ajakan notifikasi) yang dipertimbangkan; setelah
 * lembar ini tampil, ajakan notifikasi menunggu kunjungan berikutnya (tidak pernah dua lembar sekaligus).
 */
export function InstallSheet({ demo, restricted, home, toast, fallback }: InstallSheetProps) {
  const mode = useInstallMode();
  const [phase, setPhase] = useState<SheetPhase>("wait");
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (phase !== "wait" || !home || mode === null) return;
    const timer = setTimeout(() => {
      const sheet = installSheetOf({ demo, restricted, home, dialogOpen: Boolean(document.querySelector("dialog[open]")), deferred: readDeferred(), mobile: currentDevice().mobile, mode });
      setPhase(sheet ?? "none");
    }, installSheetDelayMs(mode));
    return () => clearTimeout(timer);
  }, [phase, home, mode, demo, restricted]);
  // Tawaran browser habis dipakai di tempat lain (menu / tautan masuk) -> lembar "Pasang" tidak lagi berguna.
  const visible = home && ((phase === "prompt" && mode === "prompt") || phase === "ios");
  useEffect(() => { if (visible) primary.current?.focus(); }, [visible]);
  if (phase === "none") return fallback;
  if (!visible) return null;
  const close = (days: number | null) => { if (days) defer(days); setPhase("closed"); };
  async function install() {
    const outcome = await installPrompt.prompt();
    close(outcome === "dismissed" ? INSTALL_DEFER_DAYS : null);
    toast(INSTALL_FEEDBACK[outcome]);
  }
  const ios = phase === "ios";
  return <div className="push-sheet install-sheet" role="dialog" aria-modal="false" aria-labelledby="install-sheet-title">
    <span className="quick-icon tone-0"><Icon name="download" size={24} /></span>
    <div className="push-sheet-body">
      <h2 id="install-sheet-title">{ios ? "Pasang di layar utama" : "Pasang aplikasi"}</h2>
      <p>{installIntro(ios ? "ios-safari" : "prompt")}</p>
      {ios && mode && <InstallSteps mode={mode} />}
      <div className="push-sheet-actions">
        {ios ? <><button ref={primary} type="button" className="button primary small-button" onClick={() => close(INSTALL_DEFER_DAYS)}>Mengerti</button><button type="button" className="text-button" onClick={() => close(INSTALLED_DEFER_DAYS)}>Sudah terpasang</button></>
          : <><button ref={primary} type="button" className="button primary small-button" onClick={() => void install()}>Pasang</button><button type="button" className="text-button" onClick={() => close(INSTALL_DEFER_DAYS)}>Nanti saja</button></>}
      </div>
    </div>
  </div>;
}

function InstallDialog({ mode, onClose }: { mode: InstallMode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); const el = dialog.current; return () => el?.close(); }, []);
  return <dialog ref={dialog} className="action-dialog install-dialog" aria-labelledby="install-dialog-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><div><span className="eyebrow">APLIKASI</span><h2 id="install-dialog-title">Pasang aplikasi</h2></div><button type="button" className="icon-button" aria-label="Tutup" onClick={onClose}><Icon name="close" /></button></div>
    <div className="dialog-body"><p className="install-intro">{installIntro(mode)}</p><InstallSteps mode={mode} /></div>
    <div className="dialog-footer wrap"><Link className="button secondary small-button" href="/pasang" prefetch={false}>Halaman pasang &amp; kode QR</Link><button type="button" className="button primary small-button" onClick={onClose}>Mengerti</button></div>
  </dialog>;
}

/** Item "Pasang aplikasi" di sidebar/laci Menu: tawaran browser langsung, selain itu jendela langkah. */
export function MenuInstallButton() {
  const { toast } = useHub();
  const mode = useInstallMode();
  const [open, setOpen] = useState(false);
  if (!mode || !menuInstallVisible(mode)) return null;
  async function start() {
    if (mode === "prompt") {
      const outcome = await installPrompt.prompt();
      if (outcome !== "unavailable") { toast(INSTALL_FEEDBACK[outcome]); return; }
    }
    setOpen(true);
  }
  return <>
    <button type="button" className="install-menu-button" onClick={() => void start()}><Icon name="download" size={18} /><span>Pasang aplikasi<small>Buka dari layar utama, tanpa toko aplikasi</small></span></button>
    {open && <InstallDialog mode={mode} onClose={() => setOpen(false)} />}
  </>;
}

/**
 * Tautan di halaman masuk: ada di HTML server (tanpa geser tata letak; disembunyikan CSS di aplikasi terpasang),
 * tanpa prefetch (halaman masuk = target PageSpeed). HP yang sudah ditawari browser langsung memasang di tempat.
 */
export function LoginInstallLink() {
  const prompt = useSyncExternalStore(installPrompt.subscribe, installPrompt.getSnapshot, () => "none" as const);
  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    if (prompt !== "ready" || !currentDevice().mobile) return;
    event.preventDefault();
    void installPrompt.prompt();
  }
  return <Link className="login-install" href="/pasang" prefetch={false} onClick={onClick}><Icon name="download" size={16} />Pasang aplikasi di HP</Link>;
}
