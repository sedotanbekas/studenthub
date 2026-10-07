"use client";
import { picksSchool } from "@/lib/frontend/modules";
import { useState, type KeyboardEvent } from "react";
import { currentYear, isSetupComplete, setupSteps, todayTermNotice } from "@/lib/frontend/academics-rules";
import type { Module } from "@/lib/frontend/types";
import { useHub } from "../context";
import { Icon } from "../icon";
import { AcademicsDialog, type DialogState } from "./academics-dialogs";
import { ClassesPanel, SubjectsPanel } from "./classes-subjects-panels";
import { SetupWizard } from "./setup-wizard";
import { AcademicsContext, snapshotOf, useAcademicsState, type AcademicsData } from "./use-academics";
import { YearsPanel } from "./years-panel";

/**
 * Halaman Akademik (pengganti Workspace generik). Sekolah yang persiapannya belum lengkap langsung masuk
 * panduan (wizard); setelah itu tampil tab dengan tombol biru yang menyebut objeknya. Panduan bisa dibuka
 * lagi kapan saja lewat tombol "Panduan pengaturan" di sebelah judul.
 */
type Tab = "years" | "classes" | "subjects";
type Mode = "wizard" | "tabs";
const TABS: readonly (readonly [Tab, string, string])[] = [["years", "Tahun ajaran & semester", "calendar"], ["classes", "Kelas", "users"], ["subjects", "Mata pelajaran", "book"]];

export function AcademicsPage({ module }: { module: Module }) {
  const { me, schoolId, demo } = useHub();
  const needsSchool = picksSchool(me.user.role) && !schoolId && !demo;
  const state = useAcademicsState(!needsSchool);
  const [mode, setMode] = useState<Mode | null>(null);
  const complete = state.data ? isSetupComplete(setupSteps(snapshotOf(state.data))) : true;
  // Keputusan awal sekali saja (wizard vs tab), agar wizard tidak tiba-tiba hilang saat langkah wajib terakhir selesai.
  if (state.data && mode === null) setMode(complete ? "tabs" : "wizard");
  const wizard = mode === "wizard";
  return <div className="workspace-page academics-page">
    <div className="page-heading">
      <div><h1>{module.title}</h1><p>{wizard ? "Ikuti langkah berikut sekali saja. Setelah itu, kelola semuanya lewat tab." : module.description}</p></div>
      {state.value && <div className="heading-actions">{wizard
        ? <button type="button" className="button secondary" onClick={() => setMode("tabs")}>Tutup panduan</button>
        : <button type="button" className="button secondary guide-button" onClick={() => setMode("wizard")} aria-label={complete ? "Panduan pengaturan" : "Panduan pengaturan, ada langkah yang belum selesai"}><Icon name="spark" size={17} />Panduan pengaturan{!complete && <span className="guide-dot" aria-hidden="true" />}</button>}</div>}
    </div>
    {needsSchool ? <Placeholder icon="school" title="Pilih sekolah untuk memulai" text="Gunakan pemilih sekolah di atas untuk membuka data akademik sekolah." />
      : state.loading && !state.data ? <div className="panel" role="status" aria-label="Memuat data akademik">{[1, 2, 3, 4].map((i) => <div className="skeleton" key={i} />)}</div>
      : state.error && !state.data ? <div className="empty-state"><span className="empty-icon"><Icon name="refresh" size={28} /></span><h3>Data akademik belum berhasil dimuat</h3><p role="alert">{state.error}</p><button type="button" className="button secondary" onClick={state.retry}>Coba lagi</button></div>
      : state.value && <AcademicsContext.Provider value={state.value}>{wizard ? <SetupWizard onFinish={() => setMode("tabs")} /> : <TabsView data={state.value.data} onGuide={() => setMode("wizard")} />}</AcademicsContext.Provider>}
  </div>;
}

function TabsView({ data, onGuide }: { data: AcademicsData; onGuide: () => void }) {
  const [tab, setTab] = useState<Tab>("years");
  const [classYear, setClassYear] = useState(() => currentYear(data.years, data.school.today)?.id ?? "");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const notice = todayTermNotice(snapshotOf(data));
  const showClasses = (yearId: string) => { setClassYear(yearId); setTab("classes"); };
  return <>
    {notice && <div className={`${notice.tone}-message acad-inline-notice`} role="status"><Icon name={notice.tone === "warning" ? "help" : "calendar"} size={18} /><span className="notice-text">{notice.text}</span>{notice.tone === "warning" && <button type="button" className="button secondary small-button" onClick={onGuide}>Atur semester</button>}</div>}
    <TabBar tab={tab} onChange={setTab} />
    <div role="tabpanel" id={`acad-panel-${tab}`} aria-labelledby={`acad-tab-${tab}`}>
      {tab === "years" && <YearsPanel onOpen={setDialog} onShowClasses={showClasses} />}
      {tab === "classes" && <ClassesPanel yearId={classYear} onYear={setClassYear} onOpen={setDialog} />}
      {tab === "subjects" && <SubjectsPanel onOpen={setDialog} />}
    </div>
    {dialog && <AcademicsDialog dialog={dialog} onClose={() => setDialog(null)} />}
  </>;
}

function TabBar({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length;
    const target = TABS[next]![0];
    onChange(target);
    document.getElementById(`acad-tab-${target}`)?.focus();
  };
  return <div className="monitor-tabs acad-tabs" role="tablist" aria-label="Bagian akademik" onKeyDown={onKeyDown}>
    {TABS.map(([key, label, icon]) => <button key={key} type="button" role="tab" id={`acad-tab-${key}`} className="monitor-tab" aria-selected={tab === key} aria-controls={tab === key ? `acad-panel-${key}` : undefined} tabIndex={tab === key ? 0 : -1} onClick={() => onChange(key)}>
      <Icon name={icon} size={17} />{label}
    </button>)}
  </div>;
}

function Placeholder({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{text}</p></div>;
}
