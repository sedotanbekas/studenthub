"use client";
import { useEffect, useRef, type KeyboardEvent } from "react";

/**
 * Kontrol segmen (pilih satu): periode 7/30 hari, metrik grafik, tab halaman. Pola radiogroup: panah
 * kiri/kanan/atas/bawah berpindah (melingkar), Home/End ke ujung — fokus ikut pindah ke pilihan baru.
 */
export interface SegmentOption<T extends string> { readonly value: T; readonly label: string }

const STEPS: Readonly<Record<string, number>> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Indeks tujuan tombol keyboard; null = tombol lain (tidak ditangani). */
function targetIndex(key: string, index: number, count: number): number | null {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = STEPS[key];
  return step === undefined ? null : (index + step + count) % count;
}

export function Segmented<T extends string>({ options, value, onChange, ariaLabel }: { options: readonly SegmentOption<T>[]; value: T; onChange: (value: T) => void; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Di HP kontrol bisa digeser: pilihan aktif selalu digulir ke dalam tampilan.
  useEffect(() => {
    const active = ref.current?.querySelector<HTMLElement>("[aria-checked=\"true\"]");
    const box = ref.current;
    if (!active || !box || box.scrollWidth <= box.clientWidth) return;
    box.scrollTo({ left: active.offsetLeft - (box.clientWidth - active.offsetWidth) / 2, behavior: "smooth" });
  }, [value]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!options.length) return;
    const next = targetIndex(e.key, Math.max(0, options.findIndex(o => o.value === value)), options.length);
    const option = next === null ? undefined : options[next];
    if (next === null || !option) return;
    e.preventDefault();
    if (option.value !== value) onChange(option.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=\"radio\"]")[next]?.focus();
  };
  return <div ref={ref} className="segmented" role="radiogroup" aria-label={ariaLabel} onKeyDown={onKey}>
    {options.map(o => <button key={o.value} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} className={o.value === value ? "on" : undefined} onClick={() => onChange(o.value)}>{o.label}</button>)}
  </div>;
}
