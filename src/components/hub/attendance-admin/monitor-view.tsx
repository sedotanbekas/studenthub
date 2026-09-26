"use client";
import { useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { display, number } from "@/lib/frontend/format";
import { useHub } from "../context";
import { Icon } from "../icon";
import { MonitorFilters, type MonitorFilterValue } from "./monitor-filters";
import { MonitorLegend } from "./monitor-legend";
import { MonitorList } from "./monitor-list";
import { MonitorMap, type MonitorMapHandle } from "./monitor-map";
import { filterMonitor, isOutsideRadius, todayLocal, type MonitorData, type UnlocatedEntry } from "./monitor-rules";
import { RecordDetailDialog, type DetailTarget } from "./record-detail-dialog";
import { useClassOptions, useMonitorMap } from "./use-monitor-data";

/** Tab "Peta & daftar": filter, peta check-in berkelompok, legenda, daftar tersinkron, dialog detail. */

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/** Peta < 60% terlihat (HP/tablet satu kolom: daftar di bawah peta) -> klik baris menggulir peta ke tampilan. */
function mostlyHidden(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const visible = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
  return visible < rect.height * 0.6;
}

interface MonitorViewProps { readonly filter: MonitorFilterValue; readonly onFilter: (next: MonitorFilterValue) => void }

export function MonitorView({ filter, onFilter }: MonitorViewProps) {
  const { me, demo, schoolId } = useHub();
  const needsSchool = me.user.role === "SUPER_ADMIN" && !schoolId && !demo;
  const classes = useClassOptions(!needsSchool);
  const [version, setVersion] = useState(0);
  const className = classes.find(c => c.id === filter.classId)?.name ?? null;
  const { data, loading, error } = useMonitorMap({ date: filter.date, classId: filter.classId, className }, version, !needsSchool);
  const today = useMemo(() => todayLocal(new Date(), me.school?.timezone), [me.school?.timezone]);
  if (needsSchool) return <Empty icon="school" title="Pilih sekolah untuk memulai" text="Gunakan pemilih sekolah di atas untuk membuka peta kehadiran sekolah." />;
  return <div className="monitor-view">
    <MonitorFilters value={filter} onChange={onFilter} classes={classes} counts={data?.counts ?? null} maxDate={today} />
    {error && !data ? <div className="panel"><div className="empty-state"><span className="empty-icon"><Icon name="refresh" size={28} /></span><h3>Data kehadiran belum berhasil dimuat</h3><p role="alert">{error}</p><button className="button secondary" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></div></div>
      : data ? <MonitorContent data={data} filter={filter} loading={loading} />
      : <MonitorSkeleton />}
  </div>;
}

function MonitorContent({ data, filter, loading }: { data: MonitorData; filter: MonitorFilterValue; loading: boolean }) {
  const query = useDeferredValue(filter.query);
  const shown = useMemo(() => filterMonitor(data, { statuses: filter.statuses, query }), [data, filter.statuses, query]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const mapHandle = useRef<MonitorMapHandle>(null);
  const mapBox = useRef<HTMLDivElement>(null);
  const openDetail = useCallback((id: string) => setDetail({ id, name: data.points.find(p => p.attendanceId === id)?.name ?? "Detail kehadiran" }), [data]);
  // Callback stabil: baris daftar di-memo, jadi hanya baris yang status terpilihnya berubah yang dirender ulang.
  const focusRow = useCallback((id: string) => {
    setSelectedId(id);
    mapHandle.current?.focus(id);
    const box = mapBox.current;
    if (box && mostlyHidden(box)) box.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  }, []);
  const onUnlocated = useCallback((entry: UnlocatedEntry) => { if (entry.attendanceId) setDetail({ id: entry.attendanceId, name: entry.name }); }, []);
  const outside = data.points.filter(p => isOutsideRadius(p, data.school.radiusM)).length;
  return <>
    <Notices data={data} />
    <div className="monitor-layout">
      <section className="panel monitor-map-panel" aria-labelledby="monitor-map-title">
        <div className="monitor-panel-head">
          <div><h2 id="monitor-map-title">Peta lokasi absen</h2><small>{display(data.date)} · {number(shown.points.length)} titik ditampilkan</small></div>
          {loading && <span className="monitor-loading" role="status"><span className="loader" aria-hidden="true" />Memperbarui…</span>}
          <button type="button" className="icon-button" aria-label="Tampilkan seluruh area sekolah" title="Tampilkan seluruh area sekolah" onClick={() => mapHandle.current?.fitAll()}><Icon name="location" size={19} /></button>
        </div>
        <div className="monitor-map-box" ref={mapBox} role="region" aria-label="Peta lokasi absen siswa">
          <MonitorMap school={data.school} points={shown.points} onSelect={setSelectedId} onDetail={openDetail} handle={mapHandle} />
          {shown.points.length === 0 && <p className="monitor-map-empty">{data.points.length ? "Tidak ada titik yang cocok dengan filter." : "Belum ada titik lokasi absen untuk tanggal ini."}</p>}
        </div>
        <MonitorLegend counts={data.counts} outside={outside} anomalies={data.points.filter(p => p.hasAnomaly).length} />
      </section>
      <MonitorList points={shown.points} unlocated={shown.unlocated} radiusM={data.school.radiusM} selectedId={selectedId} onFocus={focusRow} onDetail={onUnlocated} />
    </div>
    {detail && <RecordDetailDialog key={detail.id} target={detail} date={data.date} onClose={() => setDetail(null)} />}
  </>;
}

function Notices({ data }: { data: MonitorData }) {
  if (!data.isSchoolDay) return <div className="info-message" role="status"><Icon name="calendar" size={18} />{display(data.date)} bukan hari sekolah — tidak ada kehadiran yang dicatat.</div>;
  if (data.truncated) return <div className="warning-message" role="status"><Icon name="help" size={18} />Data terlalu banyak sehingga sebagian tidak ditampilkan. Pilih kelas untuk mempersempit.</div>;
  return null;
}

function MonitorSkeleton() {
  return <div className="monitor-layout" role="status" aria-label="Memuat peta kehadiran">
    <div className="panel monitor-map-panel"><div className="skeleton monitor-skeleton-map" /><div className="skeleton" /></div>
    <div className="panel monitor-list-panel">{[1, 2, 3, 4, 5, 6].map(i => <div className="skeleton monitor-skeleton-row" key={i} />)}</div>
  </div>;
}

function Empty({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="panel"><div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{text}</p></div></div>;
}
