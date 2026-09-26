"use client";

/** Legenda grafik (>= 2 seri): kunci mengikuti bentuk tanda (kotak = kolom, garis = garis); klik untuk sembunyikan/tampilkan. */
export interface LegendItem { readonly key: string; readonly label: string; readonly color: string; readonly off?: boolean; readonly value?: string }

export function ChartLegend({ items, kind = "box", onToggle }: { items: readonly LegendItem[]; kind?: "box" | "line"; onToggle?: (key: string) => void }) {
  return <ul className="chart-legend-row">{items.map(item => {
    const content = <><i className={`key ${kind}`} style={{ background: item.color }} /><span>{item.label}</span>{item.value && <b>{item.value}</b>}</>;
    return <li key={item.key}>{onToggle
      ? <button type="button" className={item.off ? "off" : undefined} aria-pressed={!item.off} onClick={() => onToggle(item.key)} title={item.off ? `Tampilkan ${item.label}` : `Sembunyikan ${item.label}`}>{content}</button>
      : <span className="legend-static">{content}</span>}</li>;
  })}</ul>;
}
