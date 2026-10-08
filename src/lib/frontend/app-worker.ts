import { deviceInfoOf, type DeviceInfo } from "./web-push-rules";

/**
 * Pembantu browser yang ringan (tanpa data demo/API) untuk hub dan halaman /pasang: jenis perangkat saat ini dan
 * pendaftaran service worker /sw.js (push + halaman offline). Hanya dipanggil di browser.
 */

export function currentDevice(): DeviceInfo {
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return deviceInfoOf(navigator.userAgent, { maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone, coarse: window.matchMedia?.("(pointer: coarse)").matches ?? false, width: window.innerWidth });
}

/** null = browser tanpa service worker / pendaftaran gagal (mis. mode privat Firefox). Tidak pernah melempar. */
export async function registerAppWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}
