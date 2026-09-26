"use client";
import { useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { areaPath, columnPath, compactNumber, dayLabel, integerAxisMax, linePath, nearestPosition, niceMax, shortDate, stackTotals, ticks, xLabelCount, xPositions } from "@/lib/frontend/chart-rules";
import { ChartLegend } from "./legend";
import { ChartTable } from "./chart-table";
import { useElementWidth } from "./use-width";

/**
 * Grafik tren per hari: kolom bertumpuk (komposisi, mis. status kehadiran) atau area (satu metrik).
 * Interaksi: crosshair + tooltip yang membaca SEMUA seri di tanggal itu (hover, sentuh, atau panah
 * kiri/kanan setelah fokus), legenda untuk menyembunyikan seri, dan tabel data untuk pembaca layar.
 */
export interface ChartSeries { readonly key: string; readonly label: string; readonly color: string; readonly values: ReadonlyArray<number | null> }
export interface TrendChartProps {
  readonly labels: readonly string[];
  readonly series: readonly ChartSeries[];
  readonly mode?: "stacked" | "area";
  readonly height?: number;
  /** Batas atas sumbu tetap (mis. 100 untuk persen). */
  readonly yCap?: number;
  readonly format?: (value: number) => string;
  readonly axisFormat?: (value: number) => string;
  readonly labelFormat?: (label: string) => string;
  readonly titleFormat?: (label: string) => string;
  /** Baris tambahan di tooltip (mis. "% hadir") untuk indeks tertentu. */
  readonly footer?: (index: number) => ReactNode;
  readonly ariaLabel: string;
  readonly loading?: boolean;
  /** Kunci seri yang disembunyikan saat pertama tampil (pengguna tetap bisa menampilkannya lewat legenda). */
  readonly initialHidden?: readonly string[];
}

const M = { top: 12, right: 12, bottom: 28, left: 44 };
const MAX_BAR = 24;
const GAP = 2;

interface Frame { readonly plotW: number; readonly plotH: number; readonly xs: number[]; readonly band: number; readonly yMax: number; readonly y: (v: number) => number }

function frameOf(width: number, height: number, count: number, max: number, mode: "stacked" | "area", cap: number | undefined, integer: boolean): Frame {
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = Math.max(0, height - M.top - M.bottom);
  const band = count > 0 ? plotW / count : plotW;
  const xs = mode === "stacked" ? Array.from({ length: count }, (_, i) => band * (i + 0.5)) : xPositions(count, plotW);
  // Data hitungan (bilangan bulat) -> garis bantu selalu bulat (tidak ada "11,25 siswa").
  const yMax = cap === undefined && integer ? integerAxisMax(max) : niceMax(max, cap);
  return { plotW, plotH, xs, band, yMax, y: v => plotH - (Math.min(v, yMax) / yMax) * plotH };
}

function useHiddenSeries(total: number, initial: readonly string[] = []) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set(initial));
  // Seri terakhir yang terlihat tidak boleh disembunyikan (grafik kosong membingungkan).
  const toggle = (key: string) => setHidden(prev => { const next = new Set(prev); if (next.has(key)) next.delete(key); else if (total - next.size > 1) next.add(key); return next; });
  return { hidden, toggle };
}

export function TrendChart(props: TrendChartProps) {
  const { labels, series, mode = "stacked", height = 240, ariaLabel, loading = false } = props;
  const format = props.format ?? compactNumber;
  const { hidden, toggle } = useHiddenSeries(series.length, props.initialHidden);
  const [active, setActive] = useState<number | null>(null);
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const visible = series.filter(s => !hidden.has(s.key));
  const max = mode === "stacked" ? Math.max(0, ...stackTotals(visible.map(s => s.values))) : Math.max(0, ...visible.flatMap(s => s.values.map(v => v ?? 0)));
  const integer = visible.every(s => s.values.every(v => v === null || Number.isInteger(v)));
  const frame = frameOf(width, height, labels.length, max, mode, props.yCap, integer);
  const current = active !== null && active < labels.length ? active : null;
  const title = current === null ? "" : (props.titleFormat ?? dayLabel)(labels[current] ?? "");
  const tipSeries = mode === "stacked" ? [...visible].reverse() : visible;
  return <figure className={`chart${loading ? " is-loading" : ""}`} aria-label={ariaLabel}>
    {series.length > 1 && <ChartLegend items={series.map(s => ({ key: s.key, label: s.label, color: s.color, off: hidden.has(s.key) }))} kind={mode === "stacked" ? "box" : "line"} onToggle={toggle} />}
    <div className="chart-canvas" ref={ref} style={{ height }}>
      {width > 0 && <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        <g transform={`translate(${M.left},${M.top})`}>
          <Grid frame={frame} axisFormat={props.axisFormat ?? compactNumber} />
          {mode === "stacked" ? <Columns frame={frame} series={visible} active={current} /> : <Areas frame={frame} series={visible} />}
          <XLabels frame={frame} labels={labels} labelFormat={props.labelFormat ?? shortDate} />
          {current !== null && <Crosshair frame={frame} index={current} series={visible} mode={mode} />}
        </g>
      </svg>}
      {max === 0 && !loading && <p className="chart-empty">Belum ada data pada periode ini.</p>}
      <Pointer frame={frame} count={labels.length} active={current} onActive={setActive} />
      {current !== null && <Tooltip frame={frame} width={width} index={current} title={title} series={tipSeries} format={format} footer={props.footer} />}
    </div>
    {/* Wilayah live PERMANEN (bukan ikut tooltip): pembaca layar hanya mengumumkan perubahan pada wilayah yang sudah ada. */}
    <p className="sr-only" aria-live="polite" aria-atomic="true">{current === null ? "" : liveText(title, tipSeries, current, format, props.footer?.(current))}</p>
    <ChartTable labels={labels} series={series} format={format} labelFormat={props.titleFormat ?? dayLabel} />
  </figure>;
}

function Grid({ frame, axisFormat }: { frame: Frame; axisFormat: (v: number) => string }) {
  return <g className="chart-grid">{ticks(frame.yMax, 4).map(t => <g key={t}>
    <line x1={0} x2={frame.plotW} y1={frame.y(t)} y2={frame.y(t)} className={t === 0 ? "baseline" : undefined} />
    <text x={-8} y={frame.y(t)} dy="0.32em" textAnchor="end">{axisFormat(t)}</text>
  </g>)}</g>;
}

/** Label sumbu x sebanyak yang muat di lebar grafik; label terakhir selalu tampil, yang terlalu dekat dengannya dilewati. */
function XLabels({ frame, labels, labelFormat }: { frame: Frame; labels: readonly string[]; labelFormat: (l: string) => string }) {
  const last = labels.length - 1;
  const step = Math.max(1, Math.ceil(labels.length / xLabelCount(frame.plotW)));
  // Label tidak boleh lebih dekat dari satu slot label (piksel) ke label terakhir yang selalu tampil.
  const slot = frame.plotW / xLabelCount(frame.plotW);
  const shown = labels.map((_, i) => i).filter(i => i === last || (i % step === 0 && (frame.xs[last] ?? 0) - (frame.xs[i] ?? 0) >= slot));
  const shift = Math.min(frame.band / 2, 10);
  return <g className="chart-x">{shown.map(i => {
    const anchor = labels.length > 1 && i === last ? "end" : labels.length > 1 && i === 0 ? "start" : "middle";
    const x = (frame.xs[i] ?? 0) + (anchor === "end" ? shift : anchor === "start" ? -shift : 0);
    return <text key={i} x={x} y={frame.plotH + 20} textAnchor={anchor}>{labelFormat(labels[i] ?? "")}</text>;
  })}</g>;
}

function Columns({ frame, series, active }: { frame: Frame; series: readonly ChartSeries[]; active: number | null }) {
  const barW = Math.max(2, Math.min(MAX_BAR, frame.band * 0.64));
  return <g className="chart-columns">{frame.xs.map((cx, i) => {
    const values = series.map(s => Math.max(0, s.values[i] ?? 0));
    const top = values.findLastIndex(v => v > 0);
    let acc = 0;
    return <g key={i} className={active !== null && active !== i ? "dim" : undefined}>{series.map((s, k) => {
      const v = values[k] ?? 0;
      if (v <= 0) return null;
      const y0 = frame.y(acc);
      acc += v;
      const y1 = frame.y(acc);
      // Celah 2px warna permukaan antarsegmen (bukan garis tepi).
      const h = y0 - y1 - (acc - v > 0 ? GAP : 0);
      return <path key={s.key} d={columnPath(cx - barW / 2, y1, barW, h, k === top ? 4 : 0)} style={{ fill: s.color }} />;
    })}</g>;
  })}</g>;
}

function Areas({ frame, series }: { frame: Frame; series: readonly ChartSeries[] }) {
  return <g className="chart-areas">{series.map(s => <g key={s.key}>
    <path d={areaPath(frame.xs, s.values, frame.y, frame.plotH)} style={{ fill: s.color }} opacity={0.12} />
    <path d={linePath(frame.xs, s.values, frame.y)} fill="none" style={{ stroke: s.color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
  </g>)}</g>;
}

function Crosshair({ frame, index, series, mode }: { frame: Frame; index: number; series: readonly ChartSeries[]; mode: "stacked" | "area" }) {
  const x = frame.xs[index] ?? 0;
  return <g className="chart-crosshair">
    <line x1={x} x2={x} y1={0} y2={frame.plotH} />
    {mode === "area" && series.map(s => { const v = s.values[index]; return v === null || v === undefined ? null : <circle key={s.key} cx={x} cy={frame.y(v)} r={5} style={{ fill: s.color }} />; })}
  </g>;
}

const KEY_MOVES: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

function Pointer({ frame, count, active, onActive }: { frame: Frame; count: number; active: number | null; onActive: (i: number | null) => void }) {
  const locate = (e: PointerEvent<HTMLDivElement>) => { const box = e.currentTarget.getBoundingClientRect(); onActive(nearestPosition(frame.xs, e.clientX - box.left)); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { onActive(null); return; }
    if (e.key === "Home" || e.key === "End") { e.preventDefault(); onActive(e.key === "Home" ? 0 : count - 1); return; }
    const move = KEY_MOVES[e.key];
    if (move === undefined) return;
    e.preventDefault();
    onActive(Math.min(count - 1, Math.max(0, (active ?? (move > 0 ? -1 : count)) + move)));
  };
  return <div className="chart-pointer" style={{ left: M.left, top: M.top, width: frame.plotW, height: frame.plotH }} tabIndex={count ? 0 : -1} role="group"
    aria-label="Baca nilai per hari: geser jari atau penunjuk, atau pakai tombol panah kiri dan kanan"
    onPointerMove={locate} onPointerDown={locate} onPointerLeave={e => { if (e.pointerType === "mouse") onActive(null); }} onKeyDown={onKey} onBlur={() => onActive(null)} />;
}

const valueText = (s: ChartSeries, index: number, format: (v: number) => string): string => {
  const v = s.values[index];
  return v === null || v === undefined ? "—" : format(v);
};

/** Kalimat untuk pembaca layar: "Senin, 21 Sep: Hadir 402, Terlambat 12. <catatan kaki bila berupa teks>". */
function liveText(title: string, series: readonly ChartSeries[], index: number, format: (v: number) => string, footer?: ReactNode): string {
  const values = `${title}: ${series.map(s => `${s.label} ${valueText(s, index, format)}`).join(", ")}`;
  return typeof footer === "string" && footer ? `${values}. ${footer}` : values;
}

interface TooltipProps { frame: Frame; width: number; index: number; title: string; series: readonly ChartSeries[]; format: (v: number) => string; footer?: (i: number) => ReactNode }
/** Tooltip visual; isinya diumumkan lewat wilayah live permanen milik grafik, jadi tooltip disembunyikan dari pembaca layar. */
function Tooltip({ frame, width, index, title, series, format, footer }: TooltipProps) {
  const x = M.left + (frame.xs[index] ?? 0);
  const flip = x > width / 2;
  return <div className={`chart-tooltip${flip ? " flip" : ""}`} style={flip ? { right: width - x + 12 } : { left: x + 12 }} aria-hidden="true">
    <strong className="chart-tooltip-title">{title}</strong>
    <ul>{series.map(s => <li key={s.key}><i style={{ background: s.color }} /><b>{valueText(s, index, format)}</b><span>{s.label}</span></li>)}</ul>
    {footer && <div className="chart-tooltip-foot">{footer(index)}</div>}
  </div>;
}
