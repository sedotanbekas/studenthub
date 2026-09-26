"use client";
import { useState, type FocusEvent, type PointerEvent } from "react";
import { donutArcs } from "@/lib/frontend/chart-rules";
import { number } from "@/lib/frontend/format";

/**
 * Donat komposisi (sedikit kategori, mis. status kehadiran hari ini). Sorotan dari tiga sumber yang
 * tidak saling bentrok: arahkan mouse (sementara), fokus keyboard pada legenda (sementara), dan
 * tap/klik segmen atau legenda (tetap; tap lagi untuk melepas). Segmen tersorot diterangkan di tengah.
 */
export interface DonutSegment { readonly key: string; readonly label: string; readonly value: number; readonly color: string }
interface DonutProps { readonly segments: readonly DonutSegment[]; readonly centerLabel: string; readonly centerValue: string; readonly ariaLabel: string; readonly size?: number }

const pctOf = (value: number, total: number): string => (total > 0 ? `${new Intl.NumberFormat("id-ID", { maximumFractionDigits: 1 }).format((value / total) * 100)}%` : "0%");

/** `:focus-visible` = fokus dari keyboard; peramban lama yang belum mengenalnya dianggap keyboard. */
function keyboardFocus(element: Element): boolean {
  try {
    return element.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Hover hanya dari mouse: di layar sentuh pointerenter ikut terpicu saat tap dan akan bentrok dengan toggle. */
function useHighlight() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  return {
    active: hovered ?? focused ?? pinned,
    pinned,
    enter: (key: string) => (e: PointerEvent) => { if (e.pointerType === "mouse") setHovered(key); },
    leave: (e: PointerEvent) => { if (e.pointerType === "mouse") setHovered(null); },
    // Fokus dari klik/tap (bukan :focus-visible) diabaikan agar klik tidak menyorot lalu langsung melepas.
    focus: (key: string) => (e: FocusEvent<HTMLElement>) => { if (keyboardFocus(e.currentTarget)) setFocused(key); },
    blur: () => setFocused(null),
    toggle: (key: string) => setPinned(prev => (prev === key ? null : key)),
  };
}

export function DonutChart({ segments, centerLabel, centerValue, ariaLabel, size = 184 }: DonutProps) {
  const h = useHighlight();
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const outer = size / 2;
  const arcs = donutArcs(segments.map(s => s.value), outer, outer - 22);
  const current = segments.find(s => s.key === h.active);
  return <div className="donut">
    <div className="donut-figure" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`${-outer} ${-outer} ${size} ${size}`} role="img" aria-label={ariaLabel}>
        {total === 0 && <circle r={outer - 11} fill="none" stroke="var(--chart-grid)" strokeWidth={22} />}
        {arcs.map(arc => { const s = segments[arc.index]!; return <path key={s.key} d={arc.path} style={{ fill: s.color }} className={h.active && h.active !== s.key ? "dim" : undefined} onPointerEnter={h.enter(s.key)} onPointerLeave={h.leave} onClick={() => h.toggle(s.key)} />; })}
      </svg>
      <div className="donut-center" aria-live="polite">
        <strong>{current ? pctOf(current.value, total) : centerValue}</strong>
        <span>{current ? current.label : centerLabel}</span>
      </div>
    </div>
    <ul className="donut-legend">{segments.map(s => <li key={s.key}>
      <button type="button" className={h.active === s.key ? "on" : undefined} aria-pressed={h.pinned === s.key} onPointerEnter={h.enter(s.key)} onPointerLeave={h.leave} onFocus={h.focus(s.key)} onBlur={h.blur} onClick={() => h.toggle(s.key)}>
        <i style={{ background: s.color }} /><span>{s.label}</span><b>{number(s.value)}</b><small>{pctOf(s.value, total)}</small>
      </button>
    </li>)}</ul>
  </div>;
}
