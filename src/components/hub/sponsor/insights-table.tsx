"use client";
import { useId, useState, type MouseEvent } from "react";
import type { AdPerformanceDto } from "@/lib/frontend/ad-types";
import { label, number, rupiah } from "@/lib/frontend/format";
import { adTone, formatCtr, SORT_OPTIONS, type AdDisplayStatus, type PerformanceSort } from "@/lib/frontend/sponsor-insights-rules";
import { Segmented } from "../charts/segmented";
import { Icon } from "../icon";

/** Gambar mini banner 2:1; tanpa gambar / gagal dimuat -> ikon gambar. */
export function AdThumb({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false);
  return <span className="ad-thumb" aria-hidden="true">
    {src && !broken
      // eslint-disable-next-line @next/next/no-img-element -- banner dari /media atau proxy berkas privat; next/image tidak melayani keduanya
      ? <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setBroken(true)} />
      : <Icon name="image" size={18} />}
  </span>;
}

/** Pil status tayang iklan (LIVE = hijau, menunggu/terjadwal = kuning, masalah = merah). */
export function AdStatus({ status }: { status: AdDisplayStatus }) {
  return <span className={`status ${adTone(status)}`}><i />{label(status)}</span>;
}

interface PerformanceTableProps {
  readonly rows: readonly AdPerformanceDto[] | null;
  readonly thumbs: ReadonlyMap<string, string>;
  readonly loading: boolean;
  readonly sort: PerformanceSort;
  readonly onSort: (sort: PerformanceSort) => void;
  readonly selected: string;
  readonly onSelect: (adId: string) => void;
}

const COLUMNS: readonly { readonly key: PerformanceSort; readonly label: string }[] = [
  { key: "impressions", label: "Tayangan" }, { key: "clicks", label: "Klik" }, { key: "ctr", label: "CTR" }, { key: "spend", label: "Biaya" },
];

/** Tabel performa per iklan; pilih baris -> filter halaman ke iklan itu (pilih lagi -> semua kampanye). */
export function PerformanceTable({ rows, thumbs, loading, sort, onSort, selected, onSelect }: PerformanceTableProps) {
  const headingId = useId();
  return <section className="panel insight-panel" aria-labelledby={headingId}>
    <div className="insight-heading">
      <div><h2 id={headingId}>Performa per iklan</h2><p>Pilih iklan untuk melihat angkanya saja.</p></div>
      <Segmented options={SORT_OPTIONS} value={sort} onChange={onSort} ariaLabel="Urutkan tabel menurut" />
    </div>
    {!rows ? <div className="chart-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>
      : !rows.length ? <p className="empty-line"><Icon name="megaphone" size={22} />Belum ada iklan.</p>
        : <div className={`table-scroll perf-scroll${loading ? " is-loading" : ""}`}><table className="perf-table">
          <thead><tr><th scope="col">Iklan</th>{COLUMNS.map(c => <th key={c.key} scope="col" className={c.key === sort ? "sorted" : undefined} aria-sort={c.key === sort ? "descending" : undefined}>{c.label}</th>)}</tr></thead>
          <tbody>{rows.map(row => <PerformanceRow key={row.adId} row={row} thumb={thumbs.get(row.adId) ?? row.imageUrl} selected={row.adId === selected} onSelect={onSelect} />)}</tbody>
        </table></div>}
  </section>;
}

function PerformanceRow({ row, thumb, selected, onSelect }: { row: AdPerformanceDto; thumb: string | null; selected: boolean; onSelect: (adId: string) => void }) {
  const choose = () => onSelect(selected ? "" : row.adId);
  // Seluruh baris bisa diklik (tetikus); tombol di sel pertama untuk papan ketik & pembaca layar.
  const onRow = (event: MouseEvent<HTMLTableRowElement>) => { if (!(event.target as Element).closest("button")) choose(); };
  return <tr className={selected ? "on" : undefined} onClick={onRow}>
    <th scope="row">
      <button type="button" className="perf-ad" aria-pressed={selected} onClick={choose} title={selected ? "Tampilkan semua kampanye" : "Tampilkan iklan ini saja"}>
        <AdThumb src={thumb} />
        <span><strong>{row.title}</strong><AdStatus status={row.displayStatus} /></span>
      </button>
    </th>
    <td data-label="Tayangan">{number(row.impressions)}</td>
    <td data-label="Klik">{number(row.clicks)}</td>
    <td data-label="CTR">{formatCtr(row.ctr)}</td>
    <td data-label="Biaya">{rupiah(row.spend)}</td>
  </tr>;
}
