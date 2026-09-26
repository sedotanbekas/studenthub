"use client";
import { memo, useEffect, useRef } from "react";
import { initials, number } from "@/lib/frontend/format";
import { AttPill } from "./att-pill";
import { isOutsideRadius, scrollToReveal, statusClass, type MapPoint, type UnlocatedEntry } from "./monitor-rules";

/**
 * Daftar siswa tersinkron dengan peta: sudah check-in (urut jam masuk) + tanpa lokasi. Baris di-memo:
 * memilih/menutup pin hanya me-render ulang dua baris yang `selected`-nya berubah (butuh `onFocus`
 * yang stabil dari pemanggil).
 */

interface MonitorListProps {
  readonly points: readonly MapPoint[];
  readonly unlocated: readonly UnlocatedEntry[];
  readonly radiusM: number;
  readonly selectedId: string | null;
  readonly onFocus: (id: string) => void;
  readonly onDetail: (entry: UnlocatedEntry) => void;
}

export function MonitorList({ points, unlocated, radiusM, selectedId, onFocus, onDetail }: MonitorListProps) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => keepVisible(scroller.current, selectedId), [selectedId]);
  return <section className="panel monitor-list-panel" aria-labelledby="monitor-list-title">
    <div className="monitor-panel-head">
      <div><h2 id="monitor-list-title">Daftar siswa</h2><small>{number(points.length)} dengan lokasi · {number(unlocated.length)} tanpa lokasi</small></div>
    </div>
    <div className="monitor-list-scroll" ref={scroller}>
      <h3 className="monitor-list-label">Sudah absen dengan lokasi<b>{number(points.length)}</b></h3>
      {points.length ? <ul className="monitor-list" aria-label="Siswa dengan lokasi">{points.map(p => <PointRow key={p.attendanceId} point={p} outside={isOutsideRadius(p, radiusM)} selected={p.attendanceId === selectedId} onFocus={onFocus} />)}</ul>
        : <p className="monitor-list-empty">Tidak ada siswa dengan lokasi yang cocok.</p>}
      <h3 className="monitor-list-label">Tanpa lokasi<b>{number(unlocated.length)}</b></h3>
      {unlocated.length ? <ul className="monitor-list" aria-label="Siswa tanpa lokasi">{unlocated.map(u => <UnlocatedRow key={u.studentId} entry={u} onDetail={onDetail} />)}</ul>
        : <p className="monitor-list-empty">Tidak ada siswa tanpa lokasi yang cocok.</p>}
    </div>
  </section>;
}

const pixels = (value: string): number => Number.parseFloat(value) || 0;

/**
 * Gulir daftar (hanya bila daftar punya gulir sendiri, yaitu desktop) agar baris terpilih terlihat;
 * scroll-margin baris (CSS) menjaga baris tidak berhenti di bawah label sticky.
 */
function keepVisible(container: HTMLDivElement | null, id: string | null): void {
  if (!container || !id || container.scrollHeight <= container.clientHeight + 1) return;
  const row = container.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
  if (!row) return;
  const box = container.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  const style = getComputedStyle(row);
  const top = rect.top - box.top + container.scrollTop;
  const next = scrollToReveal(
    { top, bottom: top + rect.height },
    { scrollTop: container.scrollTop, height: container.clientHeight },
    { top: pixels(style.scrollMarginTop), bottom: pixels(style.scrollMarginBottom) },
  );
  if (next !== null) container.scrollTop = next;
}

interface PointRowProps { readonly point: MapPoint; readonly outside: boolean; readonly selected: boolean; readonly onFocus: (id: string) => void }

const PointRow = memo(function PointRow({ point, outside, selected, onFocus }: PointRowProps) {
  return <li>
    <button type="button" className={`monitor-row${selected ? " is-selected" : ""}`} aria-current={selected ? "true" : undefined} data-id={point.attendanceId} onClick={() => onFocus(point.attendanceId)}>
      <span className={`att-avatar ${statusClass(point.status)}`} aria-hidden="true">{initials(point.name)}</span>
      <span className="monitor-row-main">
        <strong>{point.name}</strong>
        <small>{point.className ?? "Tanpa kelas"} · NIS {point.nis}</small>
        {(outside || point.hasAnomaly) && <span className="monitor-row-tags">
          {outside && <span className="row-tag is-warning">Di luar radius</span>}
          {point.hasAnomaly && <span className="row-tag is-danger"><b aria-hidden="true">!</b>Perlu ditinjau</span>}
        </span>}
      </span>
      <span className="monitor-row-side"><AttPill status={point.status} /><time>{point.checkInTimeLocal ?? "—"}</time></span>
    </button>
  </li>;
});

const UnlocatedRow = memo(function UnlocatedRow({ entry, onDetail }: { readonly entry: UnlocatedEntry; readonly onDetail: (entry: UnlocatedEntry) => void }) {
  const content = <>
    <span className={`att-avatar ${statusClass(entry.status)}`} aria-hidden="true">{initials(entry.name)}</span>
    <span className="monitor-row-main"><strong>{entry.name}</strong><small>{entry.className ?? "Tanpa kelas"} · NIS {entry.nis}</small></span>
    <span className="monitor-row-side"><AttPill status={entry.status} /></span>
  </>;
  return <li>{entry.attendanceId
    ? <button type="button" className="monitor-row" onClick={() => onDetail(entry)}>{content}</button>
    : <div className="monitor-row is-static">{content}</div>}</li>;
});
