"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/frontend/api";
import { demoInsights } from "@/lib/frontend/sponsor-insights-rules";
import { useHub } from "../context";

/**
 * Pemuatan data beranda & analitik sponsor. Mode demo tidak pernah memanggil API (data dari
 * demoInsights menurut jalur). Data lama dipertahankan selama memuat ulang agar kerangka grafik
 * tidak berkedip saat periode/metrik berganti; gagal -> data dikosongkan + pesan galat.
 */
export interface Load<T> { readonly data: T | null; readonly loading: boolean; readonly error: string }

const message = (error: unknown): string => (error instanceof Error && error.message ? error.message : "Data belum dapat dimuat. Silakan coba lagi.");

export function useSponsorData<T>(path: string | null, version = 0): Load<T> {
  const { demo } = useHub();
  const [state, setState] = useState<Load<T>>({ data: null, loading: path !== null, error: "" });
  useEffect(() => {
    if (!path) return;
    let active = true;
    Promise.resolve().then(() => { if (active) setState(s => (s.loading && !s.error ? s : { ...s, loading: true, error: "" })); });
    const load = demo ? Promise.resolve(demoInsights(path) as T) : api(path).then(r => r.data as T);
    load
      .then(data => { if (active) setState({ data: data ?? null, loading: false, error: "" }); })
      .catch((error: unknown) => { if (active) setState({ data: null, loading: false, error: message(error) }); });
    return () => { active = false; };
  }, [path, demo, version]);
  return state;
}

/** Galat pertama dari beberapa sumber (untuk satu pesan "Coba lagi"). */
export function firstError(...loads: readonly Load<unknown>[]): string {
  return loads.find(l => l.error)?.error ?? "";
}

/** Pesan galat pemuatan dengan tombol muat ulang. */
export function LoadError({ message: text, onRetry }: { message: string; onRetry: () => void }) {
  if (!text) return null;
  return <div className="error-message" role="alert">
    <span>{text}</span>
    <button type="button" className="text-button" onClick={onRetry}>Coba lagi</button>
  </div>;
}
