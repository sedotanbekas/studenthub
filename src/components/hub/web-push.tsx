"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/frontend/api";
import { demoRows } from "@/lib/frontend/demo";
import type { Identity } from "@/lib/frontend/types";
import { unreadBadge } from "@/lib/frontend/unread-badge";
import {
  appBadgeAction,
  base64UrlToBytes,
  deviceInfoOf,
  feedbackText,
  IOS_INSTALL_STEPS,
  isPromptDeferred,
  navigationKind,
  promptDeferValue,
  promptModeOf,
  promptText,
  sameServerKey,
  syncAction,
  type DeviceInfo,
  type PromptMode,
} from "@/lib/frontend/web-push-rules";
import { Icon } from "./icon";

/**
 * Notifikasi HP (Web Push, N3) di browser: status per sesi dari server, langganan per identitas, jembatan pesan
 * service worker, badge ikon aplikasi, dan lembar ajakan. Tidak ada fungsi di sini yang melempar.
 */

export interface WebPushStatus { readonly enabled: boolean; readonly publicKey: string | null; readonly subscribed: boolean }
export type Permission = NotificationPermission | "unsupported";

const DEFER_KEY = "studenthub_push_later";

export const isPushSupported = (): boolean =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

export const currentPermission = (): Permission => (isPushSupported() ? Notification.permission : "unsupported");

export function currentDevice(): DeviceInfo {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return deviceInfoOf(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone, coarse: window.matchMedia?.("(pointer: coarse)").matches ?? false, width: window.innerWidth });
}

export async function loadWebPushStatus(demo: boolean): Promise<WebPushStatus | null> {
  if (demo) return demoRows("/me/web-push") as WebPushStatus;
  try {
    return (await api("/me/web-push")).data as WebPushStatus;
  } catch {
    return null;
  }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

/** Sinkron langganan sesi ini dengan server (syncAction). true = langganan tersimpan / tidak perlu apa-apa. */
export async function syncWebPush(status: WebPushStatus, force = false): Promise<boolean> {
  if (!isPushSupported() || !status.publicKey) return false;
  try {
    const reg = await registration();
    const key = base64UrlToBytes(status.publicKey);
    const existing = await reg.pushManager.getSubscription();
    const action = syncAction({ enabled: status.enabled, supported: true, permission: Notification.permission, subscribed: status.subscribed && !force, hasBrowserSubscription: existing !== null, keyMatches: sameServerKey(existing?.options.applicationServerKey, key) });
    if (action === "none") return true;
    if (action === "resubscribe") await existing?.unsubscribe();
    const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
    await api("/me/web-push/subscription", { method: "PUT", body: JSON.stringify(subscription.toJSON()) });
    return true;
  } catch {
    return false;
  }
}

/** Tombol Aktifkan: minta izin (bentuk callback Safari lama juga), lalu langganan. */
export async function enableWebPush(status: WebPushStatus): Promise<"on" | "failed" | "dismissed" | "blocked"> {
  if (!isPushSupported()) return "failed";
  let permission: NotificationPermission;
  try {
    permission = await new Promise<NotificationPermission>((resolve) => { const result = Notification.requestPermission(resolve); if (result) void result.then(resolve); });
  } catch {
    return "failed";
  }
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "dismissed";
  return (await syncWebPush(status, true)) ? "on" : "failed";
}

export async function disableWebPush(): Promise<boolean> {
  try {
    await api("/me/web-push/subscription", { method: "DELETE" });
    const reg = await navigator.serviceWorker.getRegistration("/");
    await (await reg?.pushManager.getSubscription())?.unsubscribe();
    return true;
  } catch {
    return false;
  }
}

/** Keluar: langganan browser dilepas, badge ikon dihapus, notifikasi yang masih tampil ditutup (baris server sudah dihapus pencabutan sesi). */
export async function forgetWebPush(): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && "clearAppBadge" in navigator) await navigator.clearAppBadge();
    if (!isPushSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (!reg) return;
    for (const shown of await reg.getNotifications()) shown.close();
    await (await reg.pushManager.getSubscription())?.unsubscribe();
  } catch {
    // Diabaikan: keluar tetap berjalan.
  }
}

// ----------------------------------------------------------------------------- jembatan service worker

/** `?notif=<id>` dari klik notifikasi: tandai dibaca, buang parameter dari URL hidup (parameter lain mis. absen=1 tetap). */
function consumeNotifParam(demo: boolean): void {
  const params = new URLSearchParams(window.location.search);
  const id = params.get("notif");
  if (!id) return;
  params.delete("notif");
  const rest = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}${window.location.hash}`);
  if (demo || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return;
  void api(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" }).then(() => unreadBadge.refresh(), () => undefined);
}

function useWorkerMessages(enabled: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || !isPushSupported()) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; url?: string } | null;
      if (data?.type === "studenthub:push") unreadBadge.refresh();
      if (data?.type !== "studenthub:navigate" || typeof data.url !== "string" || !data.url.startsWith("/hub")) return;
      if (navigationKind(window.location.pathname, data.url) === "reload") window.location.assign(data.url);
      else router.push(data.url, { scroll: false });
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [enabled, router]);
}

/** Badge ikon aplikasi mengikuti jumlah belum dibaca (N1) selama izin notifikasi diberikan. */
function useAppBadge(enabled: boolean): void {
  const count = useSyncExternalStore(unreadBadge.subscribe, unreadBadge.getSnapshot, () => 0);
  useEffect(() => {
    if (!enabled) return;
    const action = appBadgeAction(count, { supported: "setAppBadge" in navigator, permission: currentPermission() });
    if (action?.kind === "set") void navigator.setAppBadge(action.count).catch(() => undefined);
    if (action?.kind === "clear") void navigator.clearAppBadge().catch(() => undefined);
  }, [count, enabled]);
}

/** Dipasang sekali di hub untuk identitas aktif (bukan demo, bukan akun terbatas). */
export function WebPushBridge({ me, demo }: { me: Identity; demo: boolean }) {
  const pathname = usePathname();
  const live = !demo && !me.user.mustChangePassword;
  useWorkerMessages(live);
  useAppBadge(live);
  useEffect(() => { consumeNotifParam(demo); }, [pathname, demo]);
  // Per identitas: sesi baru (masuk ulang) belum punya langganan -> sinkron dari status server bila izin sudah ada.
  const userId = me.user.id;
  useEffect(() => {
    if (!live || currentPermission() !== "granted") return;
    let active = true;
    void loadWebPushStatus(false).then(status => { if (active && status?.enabled) void syncWebPush(status); });
    return () => { active = false; };
  }, [live, userId]);
  return null;
}

// ----------------------------------------------------------------------------- lembar ajakan

function readDeferred(): boolean {
  try { return isPromptDeferred(localStorage.getItem(DEFER_KEY), Date.now()); } catch { return false; }
}

function deferPrompt(): void {
  try { localStorage.setItem(DEFER_KEY, promptDeferValue(Date.now())); } catch { /* penyimpanan diblokir */ }
}

const PROMPT_DELAY_MS = 1500;

function usePromptMode(me: Identity, demo: boolean, home: boolean): [PromptMode | null, WebPushStatus | null, () => void] {
  const [state, setState] = useState<{ mode: PromptMode | null; status: WebPushStatus | null }>({ mode: null, status: null });
  const restricted = me.user.mustChangePassword || me.user.totpEnrollmentRequired;
  useEffect(() => {
    if (demo || restricted || !home) return;
    let active = true;
    const timer = setTimeout(() => {
      void loadWebPushStatus(false).then(status => {
        if (!active || !status) return;
        const mode = promptModeOf({ enabled: status.enabled, demo, restricted, deferred: readDeferred(), home, dialogOpen: Boolean(document.querySelector("dialog[open]")), supported: isPushSupported(), permission: currentPermission(), device: currentDevice() });
        setState({ mode, status });
      });
    }, PROMPT_DELAY_MS);
    return () => { active = false; clearTimeout(timer); };
  }, [demo, restricted, home, me.user.id]);
  return [home ? state.mode : null, state.status, () => setState(s => ({ ...s, mode: null }))];
}

/** Lembar bawah ajakan aktifkan notifikasi (HP / aplikasi terpasang, hanya di beranda). */
export function WebPushPrompt({ me, demo, home, toast }: { me: Identity; demo: boolean; home: boolean; toast: (text: string) => void }) {
  const [mode, status, close] = usePromptMode(me, demo, home);
  const [busy, setBusy] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (mode) primary.current?.focus(); }, [mode]);
  if (!mode || !status) return null;
  const device = currentDevice();
  const later = () => { deferPrompt(); close(); };
  async function enable() {
    if (!status) return;
    setBusy(true);
    const result = await enableWebPush(status);
    setBusy(false);
    if (result === "failed") deferPrompt();
    if (result !== "dismissed") close();
    toast(feedbackText(result, device));
  }
  const ios = mode === "install-ios";
  return <div className="push-sheet" role="dialog" aria-modal="false" aria-labelledby="push-sheet-title">
    <span className="quick-icon tone-0"><Icon name="bell" size={24} /></span>
    <div className="push-sheet-body">
      <h2 id="push-sheet-title">{ios ? "Tambahkan ke Layar Utama dulu" : "Aktifkan notifikasi"}</h2>
      {ios ? <><p>Di iPhone, notifikasi hanya aktif bila studenthub.id dibuka dari ikon di layar utama.</p><ol>{IOS_INSTALL_STEPS.map(step => <li key={step}>{step}</li>)}</ol></> : <p>{promptText(me.user.role, device)}</p>}
      <div className="push-sheet-actions">
        {ios ? <button ref={primary} type="button" className="button primary small-button" onClick={later}>Mengerti</button>
          : <><button ref={primary} type="button" className="button primary small-button" disabled={busy} onClick={() => void enable()}>{busy ? "Memproses…" : "Aktifkan"}</button><button type="button" className="text-button" onClick={later}>Nanti saja</button></>}
      </div>
    </div>
  </div>;
}
