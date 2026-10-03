"use client";
import { useEffect, useState } from "react";
import { blockedHelpSteps, feedbackText, IOS_INSTALL_STEPS } from "@/lib/frontend/web-push-rules";
import { useHub } from "./context";
import { DEMO_MESSAGE, SecurityCard } from "./security-card";
import { currentDevice, currentPermission, disableWebPush, enableWebPush, isPushSupported, loadWebPushStatus, syncWebPush, type Permission, type WebPushStatus } from "./web-push";

/** Kartu "Notifikasi di perangkat ini" di Keamanan akun (N3): aktif / belum / diblokir / perlu dipasang / tidak didukung. */
export function WebPushCard() {
  const { demo, toast } = useHub();
  const [status, setStatus] = useState<WebPushStatus | null>(null);
  const [permission, setPermission] = useState<Permission>("default");
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    void loadWebPushStatus(demo).then(next => { if (active) { setStatus(next); setPermission(demo ? "default" : currentPermission()); } });
    return () => { active = false; };
  }, [demo, version]);
  if (!status?.enabled) return null;
  const device = currentDevice();
  async function run(task: () => Promise<string>) {
    if (demo) { toast(DEMO_MESSAGE); return; }
    setBusy(true);
    toast(await task());
    setBusy(false);
    setVersion(v => v + 1);
  }
  const enable = () => run(async () => feedbackText(await enableWebPush(status), device));
  const disable = () => run(async () => ((await disableWebPush()) ? feedbackText("off", device) : "Belum berhasil. Coba lagi."));
  const recheck = () => run(async () => (currentPermission() === "granted" && (await syncWebPush(status, true)) ? feedbackText("on", device) : feedbackText("blocked", device)));
  const button = (label: string, onClick: () => Promise<void>, kind = "secondary") => <button type="button" className={`button ${kind}`} disabled={busy} onClick={() => void onClick()}>{busy ? "Memproses…" : label}</button>;
  const title = "Notifikasi di perangkat ini";
  if (!demo && !isPushSupported()) {
    const install = device.ios && !device.standalone && (device.iosVersion ?? 0) >= 16.04;
    return <SecurityCard icon="bell" title={title} text={install ? "Di iPhone, notifikasi hanya aktif bila studenthub.id dibuka dari ikon di layar utama." : "Browser ini belum mendukung notifikasi."}>{install && <ol className="push-steps">{IOS_INSTALL_STEPS.map(step => <li key={step}>{step}</li>)}</ol>}</SecurityCard>;
  }
  if (permission === "denied") {
    return <SecurityCard icon="bell" title={title} text="Diblokir di browser ini. Izinkan lewat pengaturan:" action={button("Periksa lagi", recheck)}><ol className="push-steps">{blockedHelpSteps(device).map(step => <li key={step}>{step}</li>)}</ol></SecurityCard>;
  }
  if (permission === "granted" && status.subscribed) return <SecurityCard icon="bell" title={title} text="Aktif di perangkat ini." action={button("Matikan", disable)} />;
  return <SecurityCard icon="bell" title={title} text="Belum aktif. Kabar baru bisa langsung muncul di perangkat ini walau aplikasi tertutup." action={button("Aktifkan", enable, "primary")} />;
}
