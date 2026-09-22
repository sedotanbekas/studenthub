"use client";
import { useEffect, useRef, useState } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { operations } from "@/lib/frontend/catalog";
import { demoRows } from "@/lib/frontend/demo";
import { display, number } from "@/lib/frontend/format";
import type { Envelope, Module, Operation, Row } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";
import { DataTable, Details } from "./data-view";
import { Fields, defaults } from "./fields";
import { ActionDialog, actionTitle, buildPath, parameterSchema } from "./action-dialog";
import { CalendarView, FeedView, GradeSheet } from "./domain-views";
import type { SheetDto } from "@/lib/report-cards/schemas";

export function Workspace({ module }: { module: Module }) {
  const { me, schoolId, demo } = useHub();
  const available = operations.filter(op => module.paths.some(path => op.path === path || op.path.startsWith(`${path}/`)) && (demo || !op.action || me.permissions.includes(op.action)));
  const views = available.filter(op => op.method === "GET" && !op.path.includes("{") && !op.id.includes("Template"));
  const initialView = views.find(op => op.id === module.primary) ?? views[0];
  const [view, setView] = useState<Operation | undefined>(initialView);
  const [filters, setFilters] = useState<Row>(() => initialView ? defaults(parameterSchema(initialView, "query")) : {});
  const [data, setData] = useState<unknown>(undefined);
  const [meta, setMeta] = useState<Envelope["meta"]>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [action, setAction] = useState<{ op: Operation; initial?: Row } | null>(null);
  const [selected, setSelected] = useState<{ row: Row; path?: string } | null>(null);
  const selectRow = (row: Row) => setSelected({ row });
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
      if (demo) { let rows = demoRows(view.path); if (Array.isArray(rows) && query) rows = rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())); setData(rows); setMeta({ total: Array.isArray(rows) ? rows.length : undefined, page: 1, totalPages: 1 }); setLoading(false); return; }
      api(scoped(buildPath(view, params), schoolId)).then(result => { if (active) { setData(result.data); setMeta(result.meta); } }).catch(e => { if (active) { setError(e.message); setData(undefined); } }).finally(() => { if (active) setLoading(false); });
    }, query ? 300 : 0);
    return () => { active = false; clearTimeout(timer); };
  }, [view, filters, schoolId, demo, version, needsSchool, requiredMissing, query]);
  const mutations = available.filter(op => op.method !== "GET" && !op.path.includes("{"));
  const create = mutations.find(op => op.method === "POST" && op.path === view?.path) ?? mutations[0];
  const rows = Array.isArray(data) ? data as Row[] : null;
  function changeView(op: Operation) { setView(op); setFilters(defaults(parameterSchema(op, "query"))); setQuery(""); setData(undefined); setMeta(undefined); }
  const filtersSchema = view ? parameterSchema({ ...view, parameters: view.parameters.filter(p => p.name !== "q" && p.name !== "cursor" && p.name !== "page" && p.name !== "limit") }, "query") : {};
  return <div className="workspace-page"><div className="page-heading"><div><span className="eyebrow">{module.group}</span><h1>{module.title}<span className="heading-dot">.</span></h1><p>{module.description}</p></div><div className="heading-actions">{create && <button className="button primary" disabled={needsSchool} onClick={() => setAction({ op: create })}><Icon name="plus" size={17} />{create.id.startsWith("create") ? `Tambah ${module.key === "students" ? "siswa" : "baru"}` : actionTitle(create)}</button>}<OperationMenu available={available} onSelect={op => setAction({ op })} /></div></div>
    {module.key === "security" && <SecurityIntro />}
    <section className="panel data-panel"><div className="data-panel-top"><div className="view-title"><span className="module-icon"><Icon name={module.icon} size={21} /></span><div><h2>{view ? actionTitle(view) : module.title}</h2><small>{meta?.total !== undefined ? `${number(meta.total)} data ${demo ? "contoh" : "tersedia"}` : "Rapi, terhubung, mudah ditemukan."}</small></div></div>{views.length > 1 && <select className="view-select" aria-label="Pilih tampilan" value={view?.id} onChange={e => changeView(views.find(v => v.id === e.target.value)!)}>{views.map(op => <option key={op.id} value={op.id}>{actionTitle(op)}</option>)}</select>}</div>
      {view && <div className="table-toolbar"><div className="table-search"><Icon name="search" size={17} /><input aria-label="Cari data" placeholder={view.parameters.some(p => p.name === "q") ? "Cari nama atau nomor…" : "Pencarian tidak tersedia pada tampilan ini"} value={query} disabled={!view.parameters.some(p => p.name === "q")} onChange={e => { setQuery(e.target.value); setFilters(f => ({ ...f, page: 1, cursor: undefined })); }} /></div><div className="toolbar-actions">{Object.keys(filtersSchema.properties ?? {}).length > 0 && <button className={`button secondary small-button ${filterOpen ? "selected-button" : ""}`} onClick={() => setFilterOpen(!filterOpen)}><Icon name="settings" size={15} />Filter</button>}<button className="icon-button" aria-label="Muat ulang data" disabled={loading} onClick={() => setVersion(v => v + 1)}><Icon name="refresh" size={17} /></button></div></div>}
      {(filterOpen || requiredMissing) && <div className="filter-panel"><Fields schema={filtersSchema} value={filters} onChange={v => setFilters({ ...v, page: 1, cursor: undefined })} /><button className="text-button" onClick={() => { setFilters(view ? defaults(parameterSchema(view, "query")) : {}); setQuery(""); }}>Reset filter</button></div>}
      {needsSchool ? <Empty icon="school" title="Pilih sekolah untuk memulai" text="Gunakan pemilih sekolah di atas untuk membuka data sekolah." /> : requiredMissing ? <Empty icon="calendar" title="Lengkapi pilihan di atas" text="Pilih periode atau data yang ingin kamu tampilkan." /> : loading ? <div className="table-loading" role="status" aria-label="Memuat data">{[1, 2, 3, 4, 5].map(i => <div className="skeleton" key={i} />)}</div> : error ? <div className="empty-state"><span className="empty-icon"><Icon name="refresh" size={28} /></span><h3>Data belum berhasil dimuat</h3><p role="alert">{error}</p><button className="button secondary" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></div> : data !== undefined && /holidays|calendar/.test(view?.path ?? "") ? <CalendarView key={JSON.stringify(filters)} monthHint={typeof filters.month === "string" && filters.month.includes("-") ? filters.month : `${filters.year ?? new Date().getFullYear()}-${String(filters.month ?? new Date().getMonth() + 1).padStart(2, "0")}`} data={data} onSelect={selectRow} /> : view?.id === "getReportCardGradeSheet" && data ? <GradeSheet key={version} sheet={data as SheetDto} onDone={() => setVersion(v => v + 1)} /> : rows ? rows.length ? /announcements|notifications/.test(view?.path ?? "") ? <FeedView rows={rows} onSelect={selectRow} /> : <DataTable rows={rows} onSelect={selectRow} /> : <Empty icon={module.icon} title={query || Object.values(filters).some(v => v && v !== 1 && v !== 20) ? "Belum ada data yang cocok" : "Hal baik dimulai dari sini"} text={query ? "Coba kata kunci atau filter yang berbeda." : "Data akan tampil di sini setelah ditambahkan."} /> : data !== undefined ? <div className="object-content"><Details value={data} /></div> : <Empty icon={module.icon} title="Siap untuk memulai" text="Pilih tindakan di atas untuk mengelola informasi." />}
      {rows && rows.length > 0 && <div className="pagination"><span>{meta?.total !== undefined ? `${number(meta.total)} data` : `${rows.length} data pada halaman ini`}{meta?.page ? ` · Halaman ${meta.page} dari ${meta.totalPages ?? 1}` : ""}</span><div><button className="button secondary small-button" disabled={loading || Number(filters.page ?? 1) <= 1} onClick={() => setFilters(f => ({ ...f, page: Number(f.page ?? 1) - 1 }))}>Sebelumnya</button><button className="button secondary small-button" disabled={loading || (!meta?.hasMore && Number(filters.page ?? 1) >= (meta?.totalPages ?? 1))} onClick={() => setFilters(f => meta?.nextCursor ? { ...f, cursor: meta.nextCursor } : { ...f, page: Number(f.page ?? 1) + 1 })}>Berikutnya<Icon name="chevron" size={13} /></button></div></div>}
    </section>{selected && <RecordDialog key={String(selected.row.id ?? selected.path ?? "record")} row={selected.row} view={selected.path && view ? { ...view, path: selected.path } : view} available={available} onNested={(row, path) => setSelected({ row, path })} onClose={() => setSelected(null)} onAction={(op, row) => { setSelected(null); setAction({ op, initial: row }); }} />}{action && <ActionDialog key={action.op.id} op={action.op} initial={action.initial} onClose={() => setAction(null)} onDone={() => setVersion(v => v + 1)} />}</div>;
}
function Empty({ icon, title, text }: { icon: string; title: string; text: string }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={30} /></span><h3>{title}</h3><p>{text}</p></div>; }
function SecurityIntro() {
  const { me } = useHub();
  return <div className="security-intro"><span className="quick-icon tone-0"><Icon name="shield" size={29} /></span><div><h2>Ruangmu, tetap aman.</h2><p>Periksa perangkat yang terhubung dan perbarui kata sandi secara berkala.{me.user.totpEnrollmentRequired ? " Mulai dengan pendaftaran TOTP dari menu tindakan." : ""}</p></div></div>;
}
function OperationMenu({ available, onSelect }: { available: Operation[]; onSelect: (op: Operation) => void }) {
  const { schoolId, toast } = useHub();
  return <select className="action-select" aria-label="Tindakan lainnya" value="" onChange={async e => {
    const op = available.find(o => o.id === e.target.value); if (!op) return;
    if (op.id === "downloadStudentImportTemplate") {
      try { const response = await fetch(`/api/web${scoped(op.path, schoolId)}`); if (!response.ok) throw new Error("Template belum dapat diunduh. Coba masuk kembali."); const url = URL.createObjectURL(await response.blob()); const link = document.createElement("a"); link.href = url; link.download = "template-siswa.xlsx"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (e) { toast(e instanceof Error ? e.message : "Unduhan gagal."); }
    } else onSelect(op);
  }}><option value="">Tindakan lainnya</option>{available.filter(op => op.method !== "GET" || op.path.includes("{") || op.id.includes("Template")).map(op => <option key={op.id} value={op.id}>{actionTitle(op)}</option>)}</select>;
}
function RecordDialog({ row, view, available, onClose, onAction, onNested }: { onNested: (row: Row, path: string) => void; row: Row; view?: Operation; available: Operation[]; onClose: () => void; onAction: (op: Operation, row: Row) => void }) {
  const { demo, schoolId } = useHub();
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<unknown>(row);
  const [error, setError] = useState("");
  const id = row.id ?? (row.attendance as Row | undefined)?.id;
  const base = view?.path === "/school/attendance/daily" ? "/school/attendance" : view?.path;
  const related = available.filter(op => op.path.startsWith(`${base}/{id}`));
  const get = related.find(op => op.method === "GET" && op.path === `${base}/{id}`);
  useEffect(() => { dialog.current?.showModal(); const el = dialog.current; return () => el?.close(); }, []);
  useEffect(() => { let active = true; if (get && id && !demo) api(scoped(get.path.replace("{id}", encodeURIComponent(String(id))), schoolId)).then(r => { if (active) setData(r.data); }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [get, id, demo, schoolId]);
  const initial = { ...row, ...(data && typeof data === "object" && !Array.isArray(data) ? data as Row : {}), id };
  return <dialog ref={dialog} className="action-dialog detail-dialog" onCancel={e => { e.preventDefault(); onClose(); }}><div className="dialog-heading"><div><span className="eyebrow">INFORMASI LENGKAP</span><h2>{display(row.name ?? row.title ?? row.student ?? row.invoiceNo ?? "Detail data")}</h2></div><button className="icon-button" aria-label="Tutup detail" onClick={onClose}><Icon name="close" /></button></div><div className="dialog-body">{error && <div className="error-message" role="alert">{error}</div>}<Details value={data} onSelect={(nested, field) => onNested(nested, `${base?.startsWith("/student/") ? "/student" : "/school"}/${field === "submissions" ? "payment-submissions" : field}`)} /></div><div className="dialog-footer wrap">{Boolean(id) && related.filter(op => op !== get).map(op => <button key={op.id} className={`button ${op.method === "DELETE" ? "danger-outline" : "secondary"} small-button`} onClick={() => onAction(op, initial)}>{op.method === "PATCH" ? "Edit data" : op.method === "DELETE" ? "Hapus" : actionTitle(op)}</button>)}<button className="button secondary small-button" onClick={() => window.print()}><Icon name="download" size={14} />Cetak / PDF</button><button className="button primary small-button" onClick={onClose}>Selesai</button></div></dialog>;
}
