"use client";
import { compactNumber } from "@/lib/frontend/chart-rules";

/**
 * Batang horizontal berlabel (membandingkan besaran antar-kategori: kelas, provinsi, perangkat).
 * Nilai di ujung batang; rincian muncul saat hover/fokus/tap baris. Satu seri = satu warna.
 */
export interface BarItem { readonly key: string; readonly label: string; readonly value: number; readonly valueText?: string; readonly detail?: string; readonly color?: string; /** Penanda teks di baris (mis. "Perlu perhatian") — bukan hanya warna. */ readonly badge?: string }

export function BarList({ items, max, format = compactNumber, ariaLabel, onSelect }: { items: readonly BarItem[]; max?: number; format?: (v: number) => string; ariaLabel: string; onSelect?: (key: string) => void }) {
  const top = max ?? Math.max(1, ...items.map(i => i.value));
  if (!items.length) return <p className="chart-empty static">Belum ada data.</p>;
  return <ul className="bar-list" aria-label={ariaLabel}>{items.map(item => {
    const text = item.valueText ?? format(item.value);
    const width = `${Math.max(0, Math.min(100, (item.value / top) * 100))}%`;
    const body = <>
      <span className="bar-label">{item.label}{item.badge && <em className="bar-badge">{item.badge}</em>}</span>
      <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ width, background: item.color }} /></span>
      <b className="bar-value">{text}</b>
      {item.detail && <span className="bar-tip" role="tooltip">{item.detail}</span>}
    </>;
    const label = `${item.label}${item.badge ? ` (${item.badge})` : ""}: ${text}${item.detail ? `. ${item.detail}` : ""}`;
    return <li key={item.key}>{onSelect
      ? <button type="button" className="bar-row" aria-label={label} onClick={() => onSelect(item.key)}>{body}</button>
      : <div className="bar-row" tabIndex={0} aria-label={label}>{body}</div>}</li>;
  })}</ul>;
}
