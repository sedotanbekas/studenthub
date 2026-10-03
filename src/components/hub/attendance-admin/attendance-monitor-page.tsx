"use client";
import { useState, type KeyboardEvent } from "react";
import type { Module } from "@/lib/frontend/types";
import { useHub } from "../context";
import { Icon } from "../icon";
import { Workspace } from "../workspace";
import type { MonitorFilterValue } from "./monitor-filters";
import { attendanceTargetOf, todayLocal } from "./monitor-rules";
import { MonitorView } from "./monitor-view";
import { MonthlyRecapView, type RecapFilterValue } from "./monthly-recap-view";
import { RecordHost } from "./record-host";

/**
 * Kehadiran admin sekolah: tab "Peta & daftar" (peta check-in berkelompok + daftar siswa), "Rekap bulanan"
 * (matriks satu kelas satu bulan + unduh Excel, A3), dan "Data lengkap" (Workspace generik: harian, izin/sakit,
 * anomali, rekap, koreksi).
 */

type Tab = "map" | "recap" | "data";
const TABS: readonly (readonly [Tab, string, string, string])[] = [["map", "Peta & daftar", "Peta", "location"], ["recap", "Rekap bulanan", "Rekap", "calendar"], ["data", "Data lengkap", "Data", "report"]];

export function AttendanceMonitorPage({ module }: { module: Module }) {
  const { me, schoolId } = useHub();
  const [tab, setTab] = useState<Tab>("map");
  const [filter, setFilter] = useState<MonitorFilterValue>(() => ({ date: todayLocal(new Date(), me.school?.timezone), classId: "", query: "", statuses: [] }));
  const [recap, setRecap] = useState<RecapFilterValue>(() => ({ classId: "", month: todayLocal(new Date(), me.school?.timezone).slice(0, 7) }));
  return <div className="workspace-page monitor-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div></div>
    <MonitorTabs tab={tab} onChange={setTab} />
    <div role="tabpanel" id={`monitor-panel-${tab}`} aria-labelledby={`monitor-tab-${tab}`} className="monitor-tabpanel">
      {tab === "map" ? <MonitorView filter={filter} onFilter={setFilter} />
        // Ganti sekolah (super admin) -> pasang ulang agar kelas sekolah lama tidak pernah dikirim ke sekolah baru.
        : tab === "recap" ? <MonthlyRecapView key={schoolId} value={recap} onChange={setRecap} />
        : <Workspace module={module} embedded recordDialog={({ row, viewPath, onClose, onChanged }) => {
        // Baris harian/anomali -> dialog kehadiran (detail + tinjau anomali + Koreksi dari detail); lainnya generik.
        const target = attendanceTargetOf(row, viewPath);
        return target && <RecordHost target={target} date={target.date ?? todayLocal(new Date(), me.school?.timezone)} onClose={onClose} onChanged={onChanged} />;
      }} />}
    </div>
  </div>;
}

function MonitorTabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    const target = TABS[next]?.[0] ?? "map";
    onChange(target);
    document.getElementById(`monitor-tab-${target}`)?.focus();
  };
  return <div className="monitor-tabs" role="tablist" aria-label="Tampilan kehadiran" onKeyDown={onKeyDown}>
    {TABS.map(([key, label, short, icon]) => <button key={key} type="button" role="tab" id={`monitor-tab-${key}`} className="monitor-tab" aria-label={label} aria-selected={tab === key} aria-controls={tab === key ? `monitor-panel-${key}` : undefined} tabIndex={tab === key ? 0 : -1} onClick={() => onChange(key)}>
      <Icon name={icon} size={17} /><span className="tab-long">{label}</span><span className="tab-short" aria-hidden="true">{short}</span>
    </button>)}
  </div>;
}
