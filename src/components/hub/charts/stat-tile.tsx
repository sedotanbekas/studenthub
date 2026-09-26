"use client";
import { formatChange, linePath, xPositions } from "@/lib/frontend/chart-rules";
import { Icon } from "../icon";

/**
 * Kartu angka utama: label, nilai, perubahan vs periode sebelumnya (panah + teks, warna menurut baik/
 * buruk — tidak hanya warna), dan sparkline opsional (titik terakhir = periode berjalan).
 */
interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly icon?: string;
  readonly change?: number | null;
  readonly changeUnit?: string;
  /** Naik = baik (tayangan, kehadiran); false untuk metrik yang lebih baik bila turun (alpa, biaya). */
  readonly goodWhenUp?: boolean;
  /** Perubahan hanya informasi (mis. biaya iklan): tanpa warna baik/buruk. */
  readonly neutral?: boolean;
  readonly compareLabel?: string;
  readonly note?: string;
  readonly spark?: readonly number[];
}

export function StatTile({ label, value, icon, change, changeUnit = "%", goodWhenUp = true, neutral = false, compareLabel, note, spark }: StatTileProps) {
  const delta = change === undefined ? null : formatChange(change, changeUnit);
  const tone = !delta || neutral || delta.direction === "flat" ? "flat" : (delta.direction === "up") === goodWhenUp ? "good" : "bad";
  return <div className="stat-card stat-tile">
    <div><span>{label}</span>{icon && <span className="stat-icon"><Icon name={icon} size={20} /></span>}</div>
    <strong>{value}</strong>
    {delta && <small className={`delta ${tone}`}>
      {delta.direction !== "flat" && <Icon name="arrow" size={14} style={{ transform: `rotate(${delta.direction === "up" ? -45 : 45}deg)` }} />}
      <b>{delta.text}</b>{compareLabel && <span>{compareLabel}</span>}
    </small>}
    {note && <small className="stat-note">{note}</small>}
    {spark && spark.length > 1 && <Sparkline values={spark} />}
  </div>;
}

function Sparkline({ values }: { values: readonly number[] }) {
  const width = 120;
  const height = 28;
  const max = Math.max(1, ...values);
  const xs = xPositions(values.length, width - 4).map(x => x + 2);
  const y = (v: number) => height - 3 - (v / max) * (height - 6);
  const lastX = xs[xs.length - 1] ?? 0;
  return <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
    <path d={linePath(xs, values, y)} fill="none" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <circle cx={lastX} cy={y(values[values.length - 1] ?? 0)} r={3.5} />
  </svg>;
}
