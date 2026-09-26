"use client";
import { Icon } from "../icon";

/** Galat satu panel grafik + tombol coba lagi (panel lain tetap tampil). */
export function PanelError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="error-message sc-error" role="alert">
    <span>{message}</span>
    <button type="button" className="text-button" onClick={onRetry}>Coba lagi</button>
  </div>;
}

/** Kerangka memuat: satu blok grafik (opsional) + beberapa baris. */
export function PanelSkeleton({ block = false, lines = 3 }: { block?: boolean; lines?: number }) {
  return <div className="sc-skeleton" aria-hidden="true">
    {block && <div className="skeleton sc-skeleton-block" />}
    {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" />)}
  </div>;
}

/** Keadaan kosong ringkas di dalam panel. */
export function PanelEmpty({ icon, text }: { icon: string; text: string }) {
  return <div className="sc-empty">
    <span className="empty-icon"><Icon name={icon} size={24} /></span>
    <p>{text}</p>
  </div>;
}
