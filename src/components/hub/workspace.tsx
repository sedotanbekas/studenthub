"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { operations } from "@/lib/frontend/catalog";
import { demoDetail, demoRows } from "@/lib/frontend/demo";
import { demoPersonaForUser } from "@/lib/frontend/demo-personas";
import { display, number } from "@/lib/frontend/format";
import type { Envelope, Module, Operation, Row } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";
import { DataTable, Details } from "./data-view";
import { Fields, defaults } from "./fields";
import { ActionDialog, actionLabel, buildPath, parameterSchema } from "./action-dialog";
import { PageActions, ViewNoteLine, ViewTabs, viewLabel } from "./workspace-parts";
import { WIZARD_ACTIONS } from "./wizards/registry";
import { ACTION_LABELS, detailBase, pageActions, VIEW_COLUMNS, VIEW_NOTES, viewsFor } from "@/lib/frontend/workspace-rules";
import { CalendarView, FeedView, GradeSheet } from "./domain-views";
import type { SheetDto } from "@/lib/report-cards/schemas";
import { ReportCardDocument, isReportCardDetail } from "./report-card";
import { AttendanceReminderCard } from "./attendance-reminder-card";
import { NotificationPrefsCard } from "./notification-prefs";
import { SecurityPanel } from "./security-panel";
import { useLeaveIntent } from "./use-url-intent";

/** Dialog baris khusus halaman pemilik (mis. detail kehadiran + tinjau anomali); null = dialog generik. */
export type RecordDialogRenderer = (args: { row: Row; viewPath: string | undefined; onClose: () => void; onChanged: () => void }) => ReactNode | null;

/**
 * `embedded`: dipasang di dalam halaman khusus yang sudah punya judul -> judul & deskripsi modul disembunyikan.
 * `onRowSelect`: halaman pemilik membuka halamannya sendiri untuk baris (mis. detail sekolah), bukan dialog detail.
 */
export function Workspace({ module, embedded = false, recordDialog, onRowSelect }: { module: Module; embedded?: boolean; recordDialog?: RecordDialogRenderer; onRowSelect?: (row: Row) => void }) {
  const { me, schoolId, demo } = useHub();
  const available = operations.filter(op => module.paths.some(path => op.path === path || op.path.startsWith(`${path}/`)) && (demo || !op.action || me.permissions.includes(op.action)));
  const views = viewsFor(available, module.primary);
  const initialView = views[0];
  const [view, setView] = useState<Operation | undefined>(initialView);
  const [filters, setFilters] = useState<Row>(() => initialView ? defaults(parameterSchema(initialView, "query")) : {});
  const [data, setData] = useState<unknown>(undefined);
  const [meta, setMeta] = useState<Envelope["meta"]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [action, setAction] = useState<{ op: Operation; initial?: Row; fallback?: boolean } | null>(null);
  useLeaveIntent(module.key === "my-leave" && available.some(op => op.id === "createOwnLeaveRequest"), setAction);
  const [selected, setSelected] = useState<{ row: Row; path?: string } | null>(null);
  const selectRow = (row: Row) => (onRowSelect ? onRowSelect(row) : setSelected({ row }));
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState("");
  const needsSchool = me.user.role === "SUPER_ADMIN" && module.paths.some(p => p.startsWith("/school/")) && !schoolId && !demo;
  const requiredMissing = view?.parameters.some(p => p.required && !filters[p.name]);
  useEffect(() => {
    if (!view || needsSchool || requiredMissing) return;
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true); setError("");
      const params = { ...filters, ...(view.parameters.some(p => p.name === "q") && query ? { q: query } : {}) };
      if (demo) { let rows = demoRows(view.path, demoPersonaForUser(me.user.id), params); if (Array.isArray(rows) && query) rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())); setData(rows); setMeta({ total: Array.isArray(rows) ? rows.length : undefined, page: 1, totalPages: 1 }); setLoading(false); return; }
      api(scoped(buildPath(view, params), schoolId)).then(result => { if (active) { setData(result.data); setMeta(result.meta); } }).catch(e => { if (active) { setError(e.message); setData(undefined); } }).finally(() => { if (active) setLoading(false); });
    }, query ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [view, filters, schoolId, demo, version, needsSchool, requiredMissing, query, me.user.id]);
  const { create, secondary } = pageActions(available, view?.path);
  const rows = Array.isArray(data) ? data as Row[] : null;
  // Aksi per baris (ubah, nonaktifkan, setujui, ...) ada di jendela detail baris, bukan di tingkat halaman.
  const rowHint = Boolean(rows?.length) && available.some(op => op.path.startsWith(`${detailBase(view?.path)}/{id}`));
  function changeView(op: Operation) { setView(op); setFilters(defaults(parameterSchema(op, "query"))); setQuery(""); setData(undefined); setMeta(undefined); }
  // Halaman pemilik boleh mengganti dialog baris (mis. kehadiran: detail + tinjau anomali); null = dialog generik.
  const customRecord = selected && !selected.path ? recordDialog?.({ row: selected.row, viewPath: view?.path, onClose: () => setSelected(null), onChanged: () => setVersion(v => v + 1) }) : null;
  const filtersSchema = view ? parameterSchema({ ...view, parameters: view.parameters.filter(p => p.name !== "q" && p.name !== "cursor" && p.name !== "page" && p.name !== "limit") }, "query") : {};
  return <div className="workspace-page"><div className={`page-heading${embedded ? " embedded" : ""}`}>{!embedded && <div><h1>{module.title}</h1><p>{module.description}</p></div>}<PageActions create={create} secondary={secondary} disabled={needsSchool} onOpen={op => setAction({ op })} /></div>
    {module.key === "security" && <SecurityPanel />}
    {module.key === "notifications" && me.user.role === "SCHOOL_ADMIN" && <div className="security-panel"><NotificationPrefsCard /></div>}
    {module.key === "school-settings" && !needsSchool && <div className="security-panel"><AttendanceReminderCard key={`${schoolId}:${version}`} /></div>}
    {views.length > 1 && <ViewTabs views={views} current={view} onChange={changeView} />}
    <section className="panel data-panel" {...(views.length > 1 && view ? { role: "tabpanel", id: "view-panel", "aria-labelledby": `view-tab-${view.id}` } : {})}><div className="data-panel-top"><div className="view-title"><span className="module-icon"><Icon name={module.icon} size={21} /></span><div><h2>{view ? viewLabel(view) : module.title}</h2>{meta?.total !== undefined && <small>{`${number(meta.total)} data ${demo ? "contoh" : "tersedia"}`}</small>}</div></div>{rowHint && <p className="row-hint"><Icon name="arrow" size={15} />Pilih salah satu data untuk melihat detail dan tindakannya.</p>}</div>
      {view && <div className="table-toolbar"><div className="table-search"><Icon name="search" size={17} /><input aria-label="Cari data" placeholder={view.parameters.some(p => p.name === "q") ? "Cari nama atau nomor…" : "Pencarian tidak tersedia pada tampilan ini"} value={query} disabled={!view.parameters.some(p => p.name === "q")} onChange={e => { setQuery(e.target.value); setFilters(f => ({ ...f, page: 1, cursor: undefined })); }} /></div><div className="toolbar-actions">{Object.keys(filtersSchema.properties ?? {}).length > 0 && <button className={`button secondary small-button ${filterOpen ? "selected-button" : ""}`} onClick={() => setFilterOpen(!filterOpen)}><Icon name="settings" size={15} />Filter</button>}<button className="icon-button" aria-label="Muat ulang data" disabled={loading} onClick={() => setVersion(v => v + 1)}><Icon name="refresh" size={17} /></button></div></div>}
      {(filterOpen || requiredMissing) && <div className="filter-panel"><Fields schema={filtersSchema} value={filters} onChange={v => setFilters({ ...v, page: 1, cursor: undefined })} /><button className="text-button" onClick={() => { setFilters(view ? defaults(parameterSchema(view, "query")) : {}); setQuery(""); }}>Reset filter</button></div>}
      {needsSchool ? <Empty icon="school" title="Pilih sekolah untuk memulai" text="Gunakan pemilih sekolah di atas untuk membuka data sekolah." /> : requiredMissing ? <Empty icon="calendar" title="Lengkapi pilihan di atas" text="Pilih periode atau data yang ingin kamu tampilkan." /> : loading ? <div className="table-loading" role="status" aria-label="Memuat data">{[1, 2, 3, 4, 5].map(i => <div className="skeleton" key={i} />)}</div> : error ? <div className="empty-state"><span className="empty-icon"><Icon name="refresh" size={28} /></span><h3>Data belum berhasil dimuat</h3><p role="alert">{error}</p><button className="button secondary" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></div> : data !== undefined && /holidays|calendar/.test(view?.path ?? "") ? <CalendarView key={JSON.stringify(filters)} monthHint={typeof filters.month === "string" && filters.month.includes("-") ? filters.month : `${filters.year ?? new Date().getFullYear()}-${String(filters.month ?? new Date().getMonth() + 1).padStart(2, "0")}`} data={data} onSelect={selectRow} /> : view?.id === "getReportCardGradeSheet" && data ? <GradeSheet key={version} sheet={data as SheetDto} onDone={() => setVersion(v => v + 1)} /> : rows ? rows.length ? /announcements|notifications/.test(view?.path ?? "") ? <FeedView rows={rows} onSelect={selectRow} /> : <DataTable rows={rows} onSelect={selectRow} columns={VIEW_COLUMNS[view?.path ?? ""]} /> : <Empty icon={module.icon} title={query || Object.values(filters).some(v => v && v !== 1 && v !== 20) ? "Belum ada data yang cocok" : "Belum ada data"} text={query ? "Coba kata kunci atau filter yang berbeda." : "Data akan tampil di sini setelah ditambahkan."} /> : data !== undefined ? <div className="object-content"><Details value={data} /></div> : <Empty icon={module.icon} title="Siap untuk memulai" text="Pilih tindakan di atas untuk mengelola informasi." />}
      {rows && rows.length > 0 && <div className="pagination"><span>{meta?.total !== undefined ? `${number(meta.total)} data` : `${rows.length} data pada halaman ini`}{meta?.page ? ` · Halaman ${meta.page} dari ${meta.totalPages ?? 1}` : ""}</span><div><button className="button secondary small-button" disabled={loading || Number(filters.page ?? 1) <= 1} onClick={() => setFilters(f => ({ ...f, page: Number(f.page ?? 1) - 1 }))}>Sebelumnya</button><button className="button secondary small-button" disabled={loading || (!meta?.hasMore && Number(filters.page ?? 1) >= (meta?.totalPages ?? 1))} onClick={() => setFilters(f => meta?.nextCursor ? { ...f, cursor: meta.nextCursor } : { ...f, page: Number(f.page ?? 1) + 1 })}>Berikutnya<Icon name="chevron" size={13} /></button></div></div>}
      {view && <ViewNoteLine note={VIEW_NOTES[view.path]} />}
    </section>{customRecord ?? (selected && <RecordDialog key={String(selected.row.id ?? selected.path ?? "record")} row={selected.row} view={selected.path && view ? { ...view, path: selected.path } : view} available={available} onNested={(row, path) => setSelected({ row, path })} onClose={() => setSelected(null)} onAction={(op, row) => { setSelected(null); setAction({ op, initial: row }); }} />)}{action && renderAction(action, setAction, () => setVersion(v => v + 1))}</div>;
}
type ActionState = { op: Operation; initial?: Row; fallback?: boolean };
/** Operasi berpanduan dibuka sebagai wizard; sisanya (dan "formulir lengkap" dari wizard) memakai formulir generik. */
function renderAction(action: ActionState, setAction: (next: ActionState | null) => void, refresh: () => void) {
  const wizard = WIZARD_ACTIONS[action.op.id];
  if (wizard && !action.fallback && !action.initial) return wizard({ onClose: () => setAction(null), onDone: refresh, onFallback: () => setAction({ op: action.op, fallback: true }) });
  return <ActionDialog key={action.op.id} op={action.op} initial={action.initial} onClose={() => setAction(null)} onDone={refresh} />;
}
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{text}</p></div>; }
function RecordDialog({ row, view, available, onClose, onAction, onNested }: { onNested: (row: Row, path: string) => void; row: Row; view?: Operation; available: Operation[]; onClose: () => void; onAction: (op: Operation, row: Row) => void }) {
  const { demo, schoolId, me } = useHub();
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<unknown>(row);
  const [error, setError] = useState("");
  const id = row.id ?? (row.attendance as Row | undefined)?.id;
  const base = detailBase(view?.path);
  const related = available.filter(op => op.path.startsWith(`${base}/{id}`));
  const get = related.find(op => op.method === "GET" && op.path === `${base}/{id}`);
  useEffect(() => { dialog.current?.showModal(); const el = dialog.current; return () => el?.close(); }, []);
  useEffect(() => {
    let active = true;
    // Mode demo: detail hanya dari data milik persona (siswa tidak pernah melihat rekaman siswa lain).
    if (demo) { const detail = id && base ? demoDetail(base, String(id), demoPersonaForUser(me.user.id)) : null; if (detail) Promise.resolve().then(() => { if (active) setData(detail); }); }
    else if (get && id) api(scoped(get.path.replace("{id}", encodeURIComponent(String(id))), schoolId)).then(r => { if (active) setData(r.data); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [get, id, demo, schoolId, base, me.user.id]);
  const initial = { ...row, ...(data && typeof data === "object" && !Array.isArray(data) ? data as Row : {}), id };
  return <dialog ref={dialog} className="action-dialog detail-dialog" onCancel={e => { e.preventDefault(); onClose(); }}><div className="dialog-heading"><div><span className="eyebrow">INFORMASI LENGKAP</span><h2>{display(row.name ?? row.title ?? row.student ?? row.termLabel ?? row.invoiceNo ?? "Detail data")}</h2></div><button className="icon-button" aria-label="Tutup detail" onClick={onClose}><Icon name="close" /></button></div><div className="dialog-body">{error && <div className="error-message" role="alert">{error}</div>}{isReportCardDetail(data) ? <ReportCardDocument card={data} /> : <Details value={data} onSelect={(nested, field) => onNested(nested, `${base?.startsWith("/student/") ? "/student" : "/school"}/${field === "submissions" ? "payment-submissions" : field}`)} />}</div><div className="dialog-footer wrap">{Boolean(id) && related.filter(op => op !== get).map(op => <button key={op.id} className={`button ${op.method === "DELETE" ? "danger-outline" : "secondary"} small-button`} onClick={() => onAction(op, initial)}>{ACTION_LABELS[op.id]?.label ?? (op.method === "PATCH" ? "Ubah" : op.method === "DELETE" ? "Hapus" : actionLabel(op))}</button>)}<button className="button secondary small-button" onClick={() => window.print()}><Icon name="print" size={15} />{isReportCardDetail(data) ? "Cetak rapor" : "Cetak / PDF"}</button><button className="button primary small-button" onClick={onClose}>Selesai</button></div></dialog>;
}
