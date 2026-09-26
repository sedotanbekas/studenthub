"use client";
import "leaflet/dist/leaflet.css";
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { MonitorMapController, type SchoolArea } from "./monitor-map-controller";
import type { MapPoint } from "./monitor-rules";

/**
 * Peta check-in (Leaflet + OpenStreetMap). Leaflet dimuat dinamis (menyentuh `window` saat diimpor);
 * instance dibuat sekali per lokasi sekolah dan dibongkar saat unmount (aman untuk StrictMode). Bila
 * modul Leaflet gagal dimuat (koneksi putus / versi baru terbit), tampil pesan + "Coba lagi".
 */
export interface MonitorMapHandle { readonly focus: (id: string) => void; readonly fitAll: () => void }

interface MonitorMapProps {
  readonly school: SchoolArea;
  readonly points: readonly MapPoint[];
  readonly onSelect: (id: string | null) => void;
  readonly onDetail: (id: string) => void;
  readonly handle: Ref<MonitorMapHandle>;
}

export function MonitorMap({ school, points, onSelect, onDetail, handle }: MonitorMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<MonitorMapController | null>(null);
  const latest = useRef({ points, onSelect, onDetail });
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => { latest.current = { points, onSelect, onDetail }; }, [points, onSelect, onDetail]);
  const { latitude, longitude, radiusM } = school;

  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    import("leaflet").then(L => {
      const element = container.current;
      if (cancelled || !element) return;
      const created = new MonitorMapController(L, element, { latitude, longitude, radiusM }, {
        onSelect: id => latest.current.onSelect(id),
        onDetail: id => latest.current.onDetail(id),
      });
      created.setPoints(latest.current.points);
      controller.current = created;
      observer = new ResizeObserver(() => created.resize());
      observer.observe(element);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      observer?.disconnect();
      controller.current?.destroy();
      controller.current = null;
    };
  }, [latitude, longitude, radiusM, attempt]);

  useEffect(() => { controller.current?.setPoints(points); }, [points]);
  useImperativeHandle(handle, () => ({ focus: id => controller.current?.focus(id), fitAll: () => controller.current?.fitAll() }), []);
  const retry = () => {
    setFailed(false);
    setAttempt(n => n + 1);
  };
  return <>
    <div ref={container} className="monitor-canvas" />
    {failed && <div className="monitor-map-error">
      <p role="alert">Peta belum berhasil dimuat. Periksa koneksi internet, lalu coba lagi.</p>
      <button type="button" className="button secondary" onClick={retry}>Coba lagi</button>
    </div>}
  </>;
}
