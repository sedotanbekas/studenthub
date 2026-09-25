"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { cameraErrorMessage, geolocationErrorMessage } from "@/lib/frontend/attendance";

/**
 * Akses WAJIB untuk absensi: lokasi (GPS akurasi tinggi) dan kamera depan. Alur absensi tidak dapat
 * dilanjutkan sebelum keduanya aktif; bila izin dicabut / GPS dimatikan / kamera terputus di tengah
 * alur, status kembali "blocked" dan layar izin tampil lagi.
 */
export type AccessStatus = "idle" | "checking" | "granted" | "blocked";
export interface DeviceAccess {
  readonly location: AccessStatus;
  readonly camera: AccessStatus;
  readonly locationMessage: string;
  readonly cameraMessage: string;
  readonly stream: MediaStream | null;
  readonly fix: GeolocationPosition | null;
  readonly ready: boolean;
  request: () => Promise<void>;
  blockLocation: (message: string) => void;
}

const GPS_OPTIONS: PositionOptions = { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 };
const CAMERA: MediaStreamConstraints = { audio: false, video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } } };

function currentPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, GPS_OPTIONS));
}

async function watchPermission(name: "geolocation" | "camera", onDenied: () => void): Promise<(() => void) | undefined> {
  try {
    const status = await navigator.permissions.query({ name: name as PermissionName });
    const listener = () => { if (status.state === "denied") onDenied(); };
    status.addEventListener("change", listener);
    return () => status.removeEventListener("change", listener);
  } catch { return undefined; } // Browser tanpa Permissions API untuk kamera (Safari/Firefox lama): andalkan error langsung.
}

export function useDeviceAccess(): DeviceAccess {
  const [location, setLocation] = useState<AccessStatus>("idle");
  const [camera, setCamera] = useState<AccessStatus>("idle");
  const [locationMessage, setLocationMessage] = useState("");
  const [cameraMessage, setCameraMessage] = useState("");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [fix, setFix] = useState<GeolocationPosition | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const blockLocation = useCallback((message: string) => { setLocation("blocked"); setLocationMessage(message); }, []);
  const blockCamera = useCallback((message: string) => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; setStream(null); setCamera("blocked"); setCameraMessage(message);
  }, []);

  const requestLocation = useCallback(async () => {
    if (!("geolocation" in navigator)) { blockLocation("Browser ini tidak mendukung lokasi. Gunakan Chrome atau Safari terbaru."); return; }
    setLocation("checking"); setLocationMessage("");
    try { setFix(await currentPosition()); setLocation("granted"); }
    catch (e) { blockLocation(geolocationErrorMessage((e as GeolocationPositionError).code)); }
  }, [blockLocation]);

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) { blockCamera("Browser ini tidak mendukung kamera. Gunakan Chrome atau Safari terbaru."); return; }
    if (streamRef.current?.active) { setCamera("granted"); return; }
    setCamera("checking"); setCameraMessage("");
    try {
      const media = await navigator.mediaDevices.getUserMedia(CAMERA);
      media.getVideoTracks().forEach(track => track.addEventListener("ended", () => blockCamera("Kamera terputus. Izinkan kamera lagi untuk melanjutkan.")));
      streamRef.current = media; setStream(media); setCamera("granted");
    } catch (e) { blockCamera(cameraErrorMessage((e as DOMException).name)); }
  }, [blockCamera]);

  const request = useCallback(async () => {
    if (!window.isSecureContext) {
      blockLocation("Absensi membutuhkan koneksi aman (HTTPS). Buka Student Hub melalui alamat https://.");
      blockCamera("Kamera hanya dapat dibuka melalui koneksi aman (HTTPS).");
      return;
    }
    await requestLocation();
    await requestCamera();
  }, [blockCamera, blockLocation, requestCamera, requestLocation]);

  useEffect(() => {
    let active = true;
    const cleanups: (() => void)[] = [];
    const keep = (stop?: () => void) => { if (!stop) return; if (active) cleanups.push(stop); else stop(); };
    void watchPermission("geolocation", () => blockLocation("Izin lokasi dicabut. Izinkan lokasi lagi untuk melanjutkan absensi.")).then(keep);
    void watchPermission("camera", () => blockCamera("Izin kamera dicabut. Izinkan kamera lagi untuk melanjutkan absensi.")).then(keep);
    return () => { active = false; cleanups.forEach(stop => stop()); streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, [blockCamera, blockLocation]);

  return { location, camera, locationMessage, cameraMessage, stream, fix, ready: location === "granted" && camera === "granted", request, blockLocation };
}

/** Pantau posisi selama alur absensi. GPS dimatikan / izin dicabut di tengah jalan -> onBlocked. */
export function useLivePosition(active: boolean, initial: GeolocationPosition | null, onBlocked: (message: string) => void): GeolocationPosition | null {
  const [position, setPosition] = useState<GeolocationPosition | null>(initial);
  const blocked = useRef(onBlocked);
  useEffect(() => { blocked.current = onBlocked; }, [onBlocked]);
  useEffect(() => {
    if (!active || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition(setPosition, e => { if (e.code !== e.TIMEOUT) blocked.current(geolocationErrorMessage(e.code)); }, GPS_OPTIONS);
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);
  return position ?? initial;
}
