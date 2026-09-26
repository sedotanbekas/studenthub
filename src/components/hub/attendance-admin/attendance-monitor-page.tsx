"use client";
import { useState, type KeyboardEvent } from "react";
import type { Module } from "@/lib/frontend/types";
import { useHub } from "../context";
import { Icon } from "../icon";
import { Workspace } from "../workspace";
import type { MonitorFilterValue } from "./monitor-filters";
import { todayLocal } from "./monitor-rules";
import { MonitorView } from "./monitor-view";

/**
 * Kehadiran admin sekolah: tab "Peta & daftar" (peta check-in berkelompok + daftar siswa) dan
 * "Data lengkap" (Workspace generik: harian, izin/sakit, anomali, rekap, koreksi).
 */

type Tab = "map" | "data";
const TABS: readonly (readonly [Tab, string, string])[] = [["map", "Peta & daftar", "location"], ["data", "Data lengkap", "report"]];

export function AttendanceMonitorPage({ module }: { module: Module }) {
  const { me } = useHub();
  const [tab, setTab] = useState<Tab>("map");
  const [filter, setFilter] = useState<MonitorFilterValue>(() => ({ date: todayLocal(new Date(), me.school?.timezone), classId: "", query: "", statuses: [] }));
  return <div className="workspace-page monitor-page">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div></div>
    <MonitorTabs tab={tab} onChange={setTab} />
    <div role="tabpanel" id={`monitor-panel-${tab}`} aria-labelledby={`monitor-tab-${tab}`} className="monitor-tabpanel">
      {tab === "map" ? <MonitorView filter={filter} onFilter={setFilter} /> : <Workspace module={module} embedded />}
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
    {TABS.map(([key, label, icon]) => <button key={key} type="button" role="tab" id={`monitor-tab-${key}`} className="monitor-tab" aria-selected={tab === key} aria-controls={tab === key ? `monitor-panel-${key}` : undefined} tabIndex={tab === key ? 0 : -1} onClick={() => onChange(key)}>
      <Icon name={icon} size={17} />{label}
    </button>)}
  </div>;
}
