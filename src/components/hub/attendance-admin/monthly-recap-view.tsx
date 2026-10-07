"use client";
import { picksSchool } from "@/lib/frontend/modules";
import { useEffect, useState } from "react";
import { recapFileName } from "@/lib/attendance/monthly-recap-rules";
import { downloadApiFile, scoped } from "@/lib/frontend/api";
import { HubLink } from "../hub-link";
import { useHub } from "../context";
import { Icon } from "../icon";
import { todayLocal } from "./monitor-rules";
import { RecapCompact, RecapGrid, RecapLegend } from "./recap-matrix";
import {
  DEMO_DOWNLOAD_TEXT,
  canGoNextMonth,
  defaultRecapMode,
  downloadedText,
  recapNotices,
  resolveRecapClass,
  shiftRecapMonth,
  summaryLine,
  type RecapMode,
} from "./recap-view-rules";
import { useClassOptions, useMonthlyRecap } from "./use-monitor-data";

/** Tab "Rekap bulanan" (A3): satu kelas satu bulan (matriks / ringkas) + unduh Excel per kelas atau semua kelas. */

export interface RecapFilterValue { readonly classId: string; readonly month: string }

const MODE_KEY = "studenthub.recapMode";

/** Mode tampilan per perangkat (localStorage, aman bila diblokir); default ringkas di HP. */
function useRecapMode(): [RecapMode, (mode: RecapMode) => void] {
  const [mode, setMode] = useState<RecapMode>("grid");
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(MODE_KEY); } catch { stored = null; }
    const initial: RecapMode = stored === "grid" || stored === "compact" ? stored : defaultRecapMode(window.innerWidth);
    Promise.resolve().then(() => setMode(initial));
  }, []);
  return [mode, (next) => { setMode(next); try { localStorage.setItem(MODE_KEY, next); } catch { /* penyimpanan diblokir: cukup untuk sesi ini */ } }];
}

export function MonthlyRecapView({ value, onChange }: { value: RecapFilterValue; onChange: (next: RecapFilterValue) => void }) {
  const { me, demo, schoolId } = useHub();
  const needsSchool = picksSchool(me.user.role) && !schoolId && !demo;
  const classes = useClassOptions(!needsSchool);
  const classId = resolveRecapClass(value.classId, classes.options);
  const currentMonth = todayLocal(new Date(), me.school?.timezone).slice(0, 7);
  const [version, setVersion] = useState(0);
  const recap = useMonthlyRecap({ classId, month: value.month }, version, !needsSchool && !classes.loading);
  const [mode, setMode] = useRecapMode();
  if (needsSchool) return <Empty title="Pilih sekolah untuk memulai" text="Gunakan pemilih sekolah di atas untuk membuka rekap bulanan." />;
  if (!classes.loading && classes.options.length === 0) {
    return classes.error ? <Failed message={classes.error} onRetry={() => setVersion(v => v + 1)} />
      : <div className="panel"><div className="empty-state"><span className="empty-icon"><Icon name="school" size={30} /></span><h3>Belum ada kelas.</h3><p>Buat kelas di Akademik agar rekap bulanan bisa disusun.</p><HubLink href="/hub/academics" className="button secondary">Buka Akademik</HubLink></div></div>;
  }
  const className = classes.options.find(c => c.id === classId)?.name ?? null;
  return <div className="recap-view">
    <RecapToolbar classes={classes.options} classId={classId} month={value.month} currentMonth={currentMonth} mode={mode} onMode={setMode} onChange={next => onChange({ classId, month: value.month, ...next })} className={className} />
    {recap.error && !recap.data ? <Failed message={recap.error} onRetry={() => setVersion(v => v + 1)} />
      : !recap.data || classes.loading ? <div className="panel" role="status" aria-label="Memuat rekap">{[1, 2, 3, 4, 5].map(i => <div className="skeleton" key={i} />)}</div>
      : <RecapBody recap={recap.data} mode={mode} loading={recap.loading} error={recap.error} />}
  </div>;
}

interface ToolbarProps {
  readonly classes: ReadonlyArray<{ id: string; name: string }>;
  readonly classId: string;
  readonly className: string | null;
  readonly month: string;
  readonly currentMonth: string;
  readonly mode: RecapMode;
  readonly onMode: (mode: RecapMode) => void;
  readonly onChange: (next: Partial<RecapFilterValue>) => void;
}

function RecapToolbar({ classes, classId, className, month, currentMonth, mode, onMode, onChange }: ToolbarProps) {
  const monthText = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-01T00:00:00Z`));
  return <div className="panel recap-toolbar">
    <label className="monitor-control"><span className="sr-only">Kelas</span><Icon name="school" size={18} /><select value={classId} onChange={e => onChange({ classId: e.target.value })} aria-label="Kelas">{classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <div className="month-nav recap-month" role="group" aria-label="Bulan">
      <button type="button" className="icon-button" aria-label="Bulan sebelumnya" onClick={() => onChange({ month: shiftRecapMonth(month, -1) })}><Icon name="back" size={18} /></button>
      <strong aria-live="polite">{monthText}</strong>
      <button type="button" className="icon-button" aria-label="Bulan berikutnya" disabled={!canGoNextMonth(month, currentMonth)} onClick={() => onChange({ month: shiftRecapMonth(month, 1) })}><Icon name="chevron" size={18} /></button>
    </div>
    <div className="segmented" role="group" aria-label="Tampilan">
      <button type="button" className={mode === "grid" ? "on" : ""} aria-pressed={mode === "grid"} onClick={() => onMode("grid")}>Per tanggal</button>
      <button type="button" className={mode === "compact" ? "on" : ""} aria-pressed={mode === "compact"} onClick={() => onMode("compact")}>Ringkas</button>
    </div>
    <DownloadButtons classId={classId} className={className} month={month} monthText={monthText} />
  </div>;
}

function DownloadButtons({ classId, className, month, monthText }: { classId: string; className: string | null; month: string; monthText: string }) {
  const { demo, schoolId, toast } = useHub();
  const [busy, setBusy] = useState(false);
  async function download(all: boolean) {
    if (demo) { toast(DEMO_DOWNLOAD_TEXT); return; }
    setBusy(true);
    try {
      const path = `/school/attendance/monthly-recap/export?month=${encodeURIComponent(month)}${all ? "" : `&classId=${encodeURIComponent(classId)}`}`;
      await downloadApiFile(scoped(path, schoolId), recapFileName(month, all ? null : className));
      toast(downloadedText(all ? null : className, monthText));
    } catch (error) {
      toast(error instanceof Error ? error.message : "Berkas belum dapat diunduh.");
    } finally { setBusy(false); }
  }
  return <div className="recap-actions">
    <button type="button" className="button primary small-button" disabled={busy || !classId} onClick={() => void download(false)}><Icon name="download" size={16} />{busy ? "Menyiapkan…" : "Unduh Excel"}</button>
    <button type="button" className="button secondary small-button" disabled={busy} onClick={() => void download(true)}>Unduh semua kelas</button>
  </div>;
}

function RecapBody({ recap, mode, loading, error }: { recap: NonNullable<ReturnType<typeof useMonthlyRecap>["data"]>; mode: RecapMode; loading: boolean; error: string }) {
  const notices = recapNotices(recap);
  return <section className={`panel recap-panel${loading ? " is-loading" : ""}`} aria-labelledby="recap-title" aria-busy={loading}>
    <div className="recap-head">
      <h2 id="recap-title">Rekap {recap.class.name} · {recap.monthLabel}</h2>
      {loading && <span className="muted" role="status">Memperbarui…</span>}
    </div>
    {error && <p className="error-message" role="alert">{error}</p>}
    <p className="recap-summary">{summaryLine(recap.totals)}</p>
    {notices.map(text => <p key={text} className="info-message recap-notice">{text}</p>)}
    {recap.students.length === 0 ? <p className="muted">Belum ada siswa di kelas ini pada {recap.monthLabel}.</p>
      : mode === "grid" ? <RecapGrid recap={recap} /> : <RecapCompact recap={recap} />}
    <RecapLegend />
  </section>;
}

function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="panel"><div className="empty-state"><span className="empty-icon"><Icon name="refresh" size={28} /></span><h3>Rekap belum berhasil dimuat</h3><p role="alert">{message}</p><button className="button secondary" onClick={onRetry}>Coba lagi</button></div></div>;
}

function Empty({ title, text }: { title: string; text: string }) {
  return <div className="panel"><div className="empty-state"><span className="empty-icon"><Icon name="school" size={30} /></span><h3>{title}</h3><p>{text}</p></div></div>;
}
