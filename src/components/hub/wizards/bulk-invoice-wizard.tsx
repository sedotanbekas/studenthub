"use client";
import { useEffect, useState } from "react";
import { MAX_INVOICE_AMOUNT, MIN_INVOICE_AMOUNT } from "@/lib/billing/constants";
import { rupiah } from "@/lib/frontend/format";
import { bulkScopeBody, defaultBillingPeriod, defaultDueDate, defaultInvoiceTitle, MONTH_NAMES, skipSummary, type BulkScopeKind } from "@/lib/frontend/wizard-rules";
import { localParts, type SchoolTz } from "@/lib/time/zone";
import { FormError, Why } from "../academics/form-kit";
import { useSaving } from "../academics/use-academics";
import { useHub } from "../context";
import { Icon } from "../icon";
import { NumericField } from "../numeric-input";
import { StepActions, StepIntro, useWizardApi, WizardDialog, type CustomActionProps } from "./wizard-kit";

/** Wizard tagihan SPP satu periode: periode & nominal -> penerima -> pratinjau (dry run) -> terbitkan. */
interface BulkResult {
  readonly dryRun: boolean; readonly created: number; readonly totalAmount: number; readonly invoiceNoFrom: string | null; readonly invoiceNoTo: string | null;
  readonly skippedCount: number; readonly skipped: readonly { studentId: string; reason: string }[];
}
interface Period { periodYear: number; periodMonth: number; title: string; dueDate: string; amount: number | undefined }
interface Recipients { kind: BulkScopeKind; classIds: string[]; students: { id: string; name: string }[] }

const STEPS = [{ key: "period", title: "Periode & nominal" }, { key: "who", title: "Penerima" }, { key: "preview", title: "Pratinjau" }, { key: "publish", title: "Terbitkan" }];
const MONEY = { kind: "money", signed: false, asString: false } as const;

export function BulkInvoiceWizard({ onClose, onDone, onFallback }: CustomActionProps) {
  const { me, toast } = useHub();
  const { send } = useWizardApi();
  const today = localParts(new Date(), (me.school?.timezone ?? "WIB") as SchoolTz).ymd;
  const start = defaultBillingPeriod(today);
  const [index, setIndex] = useState(0);
  const [period, setPeriod] = useState<Period>({ ...start, title: defaultInvoiceTitle(start.periodYear, start.periodMonth), dueDate: defaultDueDate(start.periodYear, start.periodMonth), amount: undefined });
  const [who, setWho] = useState<Recipients>({ kind: "SCHOOL", classIds: [], students: [] });
  const [notify, setNotify] = useState(true);
  const [preview, setPreview] = useState<BulkResult | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const saving = useSaving();
  const scope = bulkScopeBody(who.kind, who.classIds, who.students.map((s) => s.id));
  const body = (dryRun: boolean) => ({ periodYear: period.periodYear, periodMonth: period.periodMonth, amount: period.amount, title: period.title.trim() || undefined, dueDate: period.dueDate || undefined, scope: scope.scope, dryRun, notify });
  const periodOk = period.amount !== undefined && period.amount >= MIN_INVOICE_AMOUNT && period.amount <= MAX_INVOICE_AMOUNT;
  const reachable = result ? 3 : preview ? 3 : periodOk && !scope.problem ? 2 : periodOk ? 1 : 0;
  const changePeriod = (next: Period) => { setPeriod(next); setPreview(null); };
  const changeWho = (next: Recipients) => { setWho(next); setPreview(null); };
  const runPreview = () => saving.run(async () => { if (scope.problem) throw new Error(scope.problem); setPreview(await send<BulkResult>("/school/invoices/bulk", "POST", body(true))); setIndex(2); });
  const runPublish = () => saving.run(async () => { const done = await send<BulkResult>("/school/invoices/bulk", "POST", body(false)); setResult(done); onDone(); toast(`${done.created} tagihan terbit.`); });
  return <WizardDialog eyebrow="Tagihan & pembayaran" title="Tagihan SPP massal" steps={STEPS} index={index} reachable={reachable} lockedBefore={result ? 3 : 0} onStep={setIndex} onClose={onClose} busy={saving.busy}
    fallback={onFallback && !result ? { label: "Formulir lengkap (nominal berbeda per siswa)", onClick: onFallback } : undefined}>
    {index === 0 && <PeriodStep period={period} onChange={changePeriod} onNext={() => setIndex(1)} ok={periodOk} />}
    {index === 1 && <RecipientsStep who={who} onChange={changeWho} problem={scope.problem ?? null} busy={saving.busy} onBack={() => setIndex(0)} onPreview={runPreview} />}
    {index === 2 && preview && <PreviewStep preview={preview} period={period} onBack={() => setIndex(1)} onNext={() => setIndex(3)} />}
    {index === 3 && <PublishStep preview={preview} result={result} notify={notify} onNotify={setNotify} busy={saving.busy} onPublish={runPublish} onBack={() => setIndex(2)} onClose={onClose} />}
    <FormError text={saving.error} />
  </WizardDialog>;
}

function PeriodStep({ period, ok, onChange, onNext }: { period: Period; ok: boolean; onChange: (p: Period) => void; onNext: () => void }) {
  const setMonth = (periodYear: number, periodMonth: number) => onChange({ ...period, periodYear, periodMonth, title: defaultInvoiceTitle(periodYear, periodMonth), dueDate: defaultDueDate(periodYear, periodMonth) });
  return <>
    <StepIntro title="Periode & nominal" why="Satu tagihan per siswa per bulan. Menjalankan ulang aman: siswa yang sudah ditagih untuk bulan ini otomatis dilewati." />
    <div className="form-grid">
      <label className="field">Bulan<select value={period.periodMonth} onChange={(e) => setMonth(period.periodYear, Number(e.target.value))}>{MONTH_NAMES.map((name, i) => <option key={name} value={i + 1}>{name}</option>)}</select></label>
      <label className="field">Tahun<select value={period.periodYear} onChange={(e) => setMonth(Number(e.target.value), period.periodMonth)}>{[-1, 0, 1].map((d) => <option key={d} value={period.periodYear + d}>{period.periodYear + d}</option>)}</select></label>
      <label className="field">Judul tagihan<input value={period.title} maxLength={100} onChange={(e) => onChange({ ...period, title: e.target.value })} /></label>
      <label className="field">Jatuh tempo<input type="date" value={period.dueDate} onChange={(e) => onChange({ ...period, dueDate: e.target.value })} /></label>
      <NumericField caption="Nominal SPP" spec={MONEY} value={period.amount} required minimum={MIN_INVOICE_AMOUNT} maximum={MAX_INVOICE_AMOUNT} hint="Minimal Rp1.000. Dipakai siswa yang tidak punya SPP khusus." onChange={(v) => onChange({ ...period, amount: typeof v === "number" ? v : undefined })} />
    </div>
    <Why>Siswa dengan SPP khusus di datanya memakai nominal itu; siswa ber-SPP khusus 0 (bebas SPP) dilewati.</Why>
    <StepActions><button type="button" className="button primary" disabled={!ok} onClick={onNext}>Pilih penerima<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

interface Option { readonly id: string; readonly name: string }
const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

function RecipientsStep({ who, problem, busy, onChange, onBack, onPreview }: { who: Recipients; problem: string | null; busy: boolean; onChange: (w: Recipients) => void; onBack: () => void; onPreview: () => void }) {
  const kinds: readonly [BulkScopeKind, string, string][] = [["SCHOOL", "Seluruh sekolah", "Semua siswa aktif"], ["CLASSES", "Kelas tertentu", "Pilih satu atau beberapa kelas"], ["STUDENTS", "Siswa terpilih", "Cari dan pilih siswa"]];
  return <>
    <StepIntro title="Penerima" why="Hanya siswa aktif yang ditagih; siswa draf, lulus, atau pindah dilewati." />
    <div className="level-options">{kinds.map(([kind, title, hint]) => <label key={kind} className={`level-card${who.kind === kind ? " selected" : ""}`}><input type="radio" name="scope" checked={who.kind === kind} onChange={() => onChange({ ...who, kind })} /><strong>{title}</strong><small>{hint}</small></label>)}</div>
    {who.kind === "CLASSES" && <ClassChecklist selected={who.classIds} onChange={(classIds) => onChange({ ...who, classIds })} />}
    {who.kind === "STUDENTS" && <StudentPicker selected={who.students} onChange={(students) => onChange({ ...who, students })} />}
    {problem && who.kind !== "SCHOOL" && <p className="field-hint">{problem}</p>}
    <StepActions back={onBack}><button type="button" className="button primary" disabled={Boolean(problem) || busy} onClick={onPreview}>{busy ? "Menghitung…" : "Lihat pratinjau"}<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

function ClassChecklist({ selected, onChange }: { selected: readonly string[]; onChange: (ids: string[]) => void }) {
  const { get } = useWizardApi();
  const [classes, setClasses] = useState<Option[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    get<Option[]>("/school/classes").then((rows) => { if (active) setClasses(rows); }).catch((e: unknown) => { if (active) setError(errorText(e, "Daftar kelas gagal dimuat.")); });
    return () => { active = false; };
  }, [get]);
  if (error) return <FormError text={error} />;
  if (!classes) return <div className="skeleton" />;
  if (classes.length === 0) return <Why tone="warning">Belum ada kelas di tahun ajaran berjalan. Buat kelas di menu Akademik.</Why>;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return <div className="acad-check-list">{classes.map((c) => <label key={c.id} className="check-field"><input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} /><span>{c.name}</span></label>)}</div>;
}

function StudentPicker({ selected, onChange }: { selected: readonly Option[]; onChange: (students: Option[]) => void }) {
  const { get } = useWizardApi();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<{ rows: Option[]; error: string }>({ rows: [], error: "" });
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      get<Option[]>(`/school/students?status=ACTIVE&limit=20${query ? `&q=${encodeURIComponent(query)}` : ""}`)
        .then((rows) => { if (active) setFound({ rows, error: "" }); })
        .catch((e: unknown) => { if (active) setFound({ rows: [], error: errorText(e, "Pencarian siswa gagal.") }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [get, query]);
  const has = (id: string) => selected.some((s) => s.id === id);
  const toggle = (student: Option) => onChange(has(student.id) ? selected.filter((s) => s.id !== student.id) : [...selected, { id: student.id, name: student.name }]);
  return <div className="student-picker">
    <input aria-label="Cari siswa" placeholder="Cari nama atau NISN…" value={query} onChange={(e) => setQuery(e.target.value)} />
    {selected.length > 0 && <div className="chip-list">{selected.map((s) => <button key={s.id} type="button" className="pill" onClick={() => toggle(s)}>{s.name} ✕</button>)}</div>}
    <FormError text={found.error} />
    <div className="acad-check-list">{found.rows.map((s) => <label key={s.id} className="check-field"><input type="checkbox" checked={has(s.id)} onChange={() => toggle(s)} /><span>{s.name}</span></label>)}</div>
  </div>;
}

function PreviewStep({ preview, period, onBack, onNext }: { preview: BulkResult; period: Period; onBack: () => void; onNext: () => void }) {
  const skipped = skipSummary(preview.skipped);
  return <>
    <StepIntro title="Pratinjau" why="Belum ada yang tersimpan. Periksa jumlahnya sebelum diterbitkan ke siswa." />
    <div className="wizard-done-card"><strong>{preview.created} tagihan baru</strong><span>{period.title || defaultInvoiceTitle(period.periodYear, period.periodMonth)} · total {rupiah(preview.totalAmount)}</span></div>
    {skipped.length > 0 && <div className="info-message"><span>Dilewati: {skipped.join("; ")}.</span></div>}
    <StepActions back={onBack}><button type="button" className="button primary" disabled={preview.created === 0} onClick={onNext}>Lanjut terbitkan<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

interface PublishProps { preview: BulkResult | null; result: BulkResult | null; notify: boolean; busy: boolean; onNotify: (v: boolean) => void; onPublish: () => void; onBack: () => void; onClose: () => void }

function PublishStep({ preview, result, notify, busy, onNotify, onPublish, onBack, onClose }: PublishProps) {
  if (result) return <>
    <StepIntro title="Tagihan terbit" tone="success" why={`${result.created} tagihan dibuat${result.invoiceNoFrom ? ` (${result.invoiceNoFrom} – ${result.invoiceNoTo})` : ""}, total ${rupiah(result.totalAmount)}.`} />
    <StepActions><button type="button" className="button primary" onClick={onClose}>Selesai</button></StepActions>
  </>;
  return <>
    <StepIntro title="Terbitkan" why="Tagihan langsung terlihat di aplikasi siswa beserta rekening tujuan transfer." />
    <label className="check-field"><input type="checkbox" checked={notify} onChange={(e) => onNotify(e.target.checked)} /><span>Kirim notifikasi ke siswa<small>Siswa mendapat pemberitahuan tagihan baru di aplikasi.</small></span></label>
    <StepActions back={onBack}><button type="button" className="button primary" disabled={busy || !preview?.created} onClick={onPublish}>{busy ? "Menerbitkan…" : `Terbitkan ${preview?.created ?? 0} tagihan`}</button></StepActions>
  </>;
}
