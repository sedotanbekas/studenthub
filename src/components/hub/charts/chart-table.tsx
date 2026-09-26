"use client";
import type { ChartSeries } from "./trend-chart";

/** Tabel data di balik grafik (terlipat): nilai tetap terjangkau tanpa hover, untuk pembaca layar & cetak. */
export function ChartTable({ labels, series, format, labelFormat }: { labels: readonly string[]; series: readonly ChartSeries[]; format: (v: number) => string; labelFormat: (l: string) => string }) {
  if (!labels.length) return null;
  return <details className="chart-table">
    <summary>Lihat data dalam tabel</summary>
    <div className="table-scroll"><table>
      <thead><tr><th scope="col">Tanggal</th>{series.map(s => <th key={s.key} scope="col">{s.label}</th>)}</tr></thead>
      <tbody>{labels.map((label, i) => <tr key={label}><th scope="row">{labelFormat(label)}</th>{series.map(s => { const v = s.values[i]; return <td key={s.key}>{v === null || v === undefined ? "—" : format(v)}</td>; })}</tr>)}</tbody>
    </table></div>
  </details>;
}
