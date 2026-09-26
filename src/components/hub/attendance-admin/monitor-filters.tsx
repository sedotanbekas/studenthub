"use client";
import { number } from "@/lib/frontend/format";
import { Icon } from "../icon";
import { MONITOR_STATUSES, STATUS_META, countOf, statusClass, toggleStatus, totalCount, type MapCounts, type MonitorStatus } from "./monitor-rules";
import type { ClassOption } from "./use-monitor-data";

/** Baris filter: tanggal, kelas, cari (klien), dan chip status berjumlah (filter peta & daftar). */

export interface MonitorFilterValue {
  readonly date: string;
  readonly classId: string;
  readonly query: string;
  readonly statuses: readonly MonitorStatus[];
}

interface MonitorFiltersProps {
  readonly value: MonitorFilterValue;
  readonly onChange: (next: MonitorFilterValue) => void;
  readonly classes: readonly ClassOption[];
  readonly counts: MapCounts | null;
  readonly maxDate: string;
}

export function MonitorFilters({ value, onChange, classes, counts, maxDate }: MonitorFiltersProps) {
  const patch = (next: Partial<MonitorFilterValue>) => onChange({ ...value, ...next });
  return <div className="monitor-toolbar">
    <div className="monitor-filter-row">
      <label className="monitor-control">
        <Icon name="calendar" size={18} /><span className="sr-only">Tanggal</span>
        <input type="date" value={value.date} max={maxDate} onChange={e => { if (e.target.value) patch({ date: e.target.value }); }} />
      </label>
      <label className="monitor-control">
        <Icon name="school" size={18} /><span className="sr-only">Kelas</span>
        <select value={value.classId} onChange={e => patch({ classId: e.target.value })}>
          <option value="">Semua kelas</option>
          {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="monitor-control is-search">
        <Icon name="search" size={18} /><span className="sr-only">Cari nama atau NIS</span>
        <input type="search" placeholder="Cari nama atau NIS…" value={value.query} onChange={e => patch({ query: e.target.value })} />
      </label>
    </div>
    <StatusChips value={value.statuses} counts={counts} onChange={statuses => patch({ statuses })} />
  </div>;
}

function StatusChips({ value, counts, onChange }: { value: readonly MonitorStatus[]; counts: MapCounts | null; onChange: (next: MonitorStatus[]) => void }) {
  const amount = (n: number | undefined) => (n === undefined ? "–" : number(n));
  const all = amount(counts ? totalCount(counts) : undefined);
  return <div className="monitor-chips" role="group" aria-label="Saring menurut status">
    <button type="button" className="att-chip is-all" aria-pressed={value.length === 0} aria-label={`Semua status (${all})`} onClick={() => onChange([])}>
      Semua<b>{all}</b>
    </button>
    {MONITOR_STATUSES.map(status => {
      const n = amount(counts ? countOf(counts, status) : undefined);
      return <button key={status} type="button" className={`att-chip ${statusClass(status)}`} aria-pressed={value.includes(status)} aria-label={`${STATUS_META[status].label} (${n})`} onClick={() => onChange(toggleStatus(value, status))}>
        <i aria-hidden="true">{STATUS_META[status].letter}</i>{STATUS_META[status].label}<b>{n}</b>
      </button>;
    })}
  </div>;
}
