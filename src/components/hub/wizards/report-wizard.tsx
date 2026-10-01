"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { publishPlan, subjectProgress, type Readiness } from "@/lib/frontend/wizard-rules";
import type { SheetDto } from "@/lib/report-cards/schemas";
import { FormError, Why } from "../academics/form-kit";
import { useSaving } from "../academics/use-academics";
import { GradeSheet } from "../domain-views";
import { HubLink } from "../hub-link";
import { useHub } from "../context";
import { Icon } from "../icon";
import { StepActions, StepIntro, useWizardApi, WizardDialog, type CustomActionProps } from "./wizard-kit";

/** Wizard rapor satu kelas: semester & kelas -> mapel kelas -> isi nilai per mapel -> terbitkan rapor yang lengkap. */
interface TermOption { readonly id: string; readonly label: string; readonly academicYearId: string; readonly isActive?: boolean }
interface YearRow { readonly id: string; readonly terms: readonly { id: string; label: string; isActive?: boolean }[] }
interface Named { readonly id: string; readonly name: string }
interface ClassSubject { readonly subjectId: string; readonly name: string }

const STEPS = [{ key: "pick", title: "Semester & kelas" }, { key: "subjects", title: "Mapel kelas" }, { key: "grades", title: "Isi nilai" }, { key: "publish", title: "Terbitkan" }];
const isReadiness = (value: unknown): value is Readiness => Boolean(value && typeof value === "object" && Array.isArray((value as Readiness).ready));

type LoadKind = "terms" | "subjects" | "readiness";
interface Failure { readonly kind: LoadKind; readonly text: string }
const errorText = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

/** Data wizard rapor. `selection` naik tiap ganti semester/kelas: respons lama yang datang terlambat diabaikan. */
function useReportData() {
  const { get } = useWizardApi();
  const [terms, setTerms] = useState<TermOption[] | null>(null);
  const [termId, setTermId] = useState("");
  const [classId, setClassId] = useState("");
  const [subjects, setSubjects] = useState<ClassSubject[] | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const selection = useRef(0);
  const loadTerms = useCallback(() => {
    get<YearRow[]>("/school/academic-years").then((years) => {
      const list = (Array.isArray(years) ? years : []).flatMap((y) => (y.terms ?? []).map((t) => ({ ...t, academicYearId: y.id })));
      setTerms(list); setTermId((list.find((t) => t.isActive) ?? list[0])?.id ?? "");
    }).catch((e: unknown) => setFailure({ kind: "terms", text: errorText(e, "Daftar semester gagal dimuat.") }));
  }, [get]);
  useEffect(() => { loadTerms(); }, [loadTerms]);
  const loadReadiness = useCallback(() => {
    if (!termId || !classId) return;
    const ticket = selection.current;
    get<unknown>(`/school/report-cards/readiness?termId=${encodeURIComponent(termId)}&classId=${encodeURIComponent(classId)}`)
      .then((r) => { if (ticket !== selection.current) return; if (isReadiness(r)) setReadiness(r); else setFailure({ kind: "readiness", text: "Data kesiapan rapor tidak dikenali." }); })
      .catch((e: unknown) => { if (ticket === selection.current) setFailure({ kind: "readiness", text: errorText(e, "Kesiapan rapor gagal dimuat.") }); });
  }, [get, termId, classId]);
  const loadSubjects = useCallback(() => {
    const ticket = selection.current;
    get<{ subjects?: ClassSubject[] }>(`/school/classes/${encodeURIComponent(classId)}/subjects`)
      .then((dto) => { if (ticket === selection.current) setSubjects(dto?.subjects ?? []); })
      .catch((e: unknown) => { if (ticket === selection.current) setFailure({ kind: "subjects", text: errorText(e, "Mapel kelas gagal dimuat.") }); });
  }, [get, classId]);
  const choose = (nextTerm: string, nextClass: string) => { selection.current += 1; setTermId(nextTerm); setClassId(nextClass); setSubjects(null); setReadiness(null); setFailure(null); };
  const retry = () => { const kind = failure?.kind; setFailure(null); if (kind === "terms") loadTerms(); else if (kind === "subjects") loadSubjects(); else loadReadiness(); };
  return { terms, termId, classId, subjects, readiness, failure, choose, loadSubjects, loadReadiness, retry };
}

export function ReportWizard({ onClose, onDone, onFallback }: CustomActionProps) {
  const data = useReportData();
  const { terms, termId, classId, subjects, readiness } = data;
  const [index, setIndex] = useState(0);
  const next = () => { data.loadSubjects(); data.loadReadiness(); setIndex(1); };
  const afterSave = () => { data.loadReadiness(); onDone(); };
  const reachable = !termId || !classId ? 0 : !subjects ? 1 : subjects.length === 0 ? 1 : 3;
  const term = terms?.find((t) => t.id === termId);
  return <WizardDialog eyebrow="Rapor siswa" title="Isi nilai & terbitkan rapor" steps={STEPS} index={index} reachable={reachable} onStep={setIndex} onClose={onClose}
    fallback={onFallback ? { label: "Buka formulir lengkap", onClick: onFallback } : undefined}>
    {index === 0 && <PickStep terms={terms} term={term} classId={classId} onChoose={data.choose} onNext={next} />}
    {index === 1 && <SubjectsStep subjects={subjects} onBack={() => setIndex(0)} onNext={() => setIndex(2)} />}
    {index === 2 && subjects && <GradesStep termId={termId} classId={classId} subjects={subjects} readiness={readiness} onSaved={afterSave} onBack={() => setIndex(1)} onNext={() => setIndex(3)} />}
    {index === 3 && <PublishStep termId={termId} classId={classId} readiness={readiness} onPublished={afterSave} onBack={() => setIndex(2)} onClose={onClose} />}
    {data.failure && <div className="error-message" role="alert"><Icon name="help" size={18} /><span>{data.failure.text}</span><button type="button" className="button secondary small-button" onClick={data.retry}>Coba lagi</button></div>}
  </WizardDialog>;
}

function PickStep({ terms, term, classId, onChoose, onNext }: { terms: TermOption[] | null; term: TermOption | undefined; classId: string; onChoose: (termId: string, classId: string) => void; onNext: () => void }) {
  const { get } = useWizardApi();
  const [classes, setClasses] = useState<{ rows: Named[]; error: string }>({ rows: [], error: "" });
  useEffect(() => {
    if (!term) return;
    let active = true;
    get<Named[]>(`/school/classes?academicYearId=${encodeURIComponent(term.academicYearId)}`)
      .then((rows) => { if (active) setClasses({ rows: Array.isArray(rows) ? rows : [], error: "" }); })
      .catch((e: unknown) => { if (active) setClasses({ rows: [], error: errorText(e, "Daftar kelas gagal dimuat.") }); });
    return () => { active = false; };
  }, [get, term]);
  if (!terms) return <div className="skeleton" />;
  if (terms.length === 0) return <Why tone="warning">Belum ada semester. <HubLink href="/hub/academics" className="text-link">Buat di menu Akademik</HubLink>.</Why>;
  return <>
    <StepIntro title="Pilih semester & kelas" why="Rapor dibuat per siswa per semester; nilai diisi per kelas agar sekali kerja untuk satu kelas penuh." />
    <div className="form-grid">
      <label className="field">Semester<select value={term?.id ?? ""} onChange={(e) => onChoose(e.target.value, "")}>{terms.map((t) => <option key={t.id} value={t.id}>{t.label}{t.isActive ? " (aktif)" : ""}</option>)}</select></label>
      <label className="field">Kelas<select value={classId} onChange={(e) => onChoose(term?.id ?? "", e.target.value)}><option value="">Pilih kelas</option>{classes.rows.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    </div>
    <FormError text={classes.error} />
    <StepActions><button type="button" className="button primary" disabled={!term || !classId} onClick={onNext}>Lanjut<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

function SubjectsStep({ subjects, onBack, onNext }: { subjects: ClassSubject[] | null; onBack: () => void; onNext: () => void }) {
  if (!subjects) return <div className="skeleton" />;
  return <>
    <StepIntro title="Mapel kelas" tone={subjects.length ? "info" : "warning"} why={subjects.length ? "Mapel ini yang muncul di rapor kelas; rapor lengkap bila semua mapel bernilai." : "Kelas ini belum punya mapel, jadi rapor belum bisa diisi."} />
    {subjects.length > 0 ? <div className="chip-list">{subjects.map((s) => <span key={s.subjectId} className="pill">{s.name}</span>)}</div>
      : <HubLink href="/hub/academics" className="button secondary">Atur mapel kelas di Akademik<Icon name="arrow" size={16} /></HubLink>}
    <StepActions back={onBack}><button type="button" className="button primary" disabled={subjects.length === 0} onClick={onNext}>Isi nilai<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

interface GradesProps { termId: string; classId: string; subjects: ClassSubject[]; readiness: Readiness | null; onSaved: () => void; onBack: () => void; onNext: () => void }

function GradesStep({ termId, classId, subjects, readiness, onSaved, onBack, onNext }: GradesProps) {
  const { get } = useWizardApi();
  const [sheet, setSheet] = useState<SheetDto | null>(null);
  const saving = useSaving();
  const progress = readiness ? subjectProgress(readiness, subjects) : subjects.map((s) => ({ ...s, missing: -1 }));
  const open = (subjectId: string) => saving.run(async () => { setSheet(await get<SheetDto>(`/school/report-cards/sheet?termId=${encodeURIComponent(termId)}&classId=${encodeURIComponent(classId)}&subjectId=${encodeURIComponent(subjectId)}`)); });
  if (sheet) return <>
    <StepIntro title={`Nilai ${sheet.subject.name}`} why={`KKM ${sheet.subject.kkm}. Nilai tersimpan per mapel; boleh diisi bertahap.`} />
    <GradeSheet sheet={sheet} onDone={() => { onSaved(); setSheet(null); }} />
    <StepActions><button type="button" className="button secondary" onClick={() => setSheet(null)}>Kembali ke daftar mapel</button></StepActions>
  </>;
  return <>
    <StepIntro title="Isi nilai per mapel" why="Pilih mapel, isi nilai satu kelas sekaligus, lalu kembali ke daftar ini. Jumlah 'belum bernilai' berkurang setelah disimpan." />
    <ul className="subject-progress">{progress.map((s) => <li key={s.subjectId}>
      <span><strong>{s.name}</strong><small>{s.missing < 0 ? "Memuat…" : s.missing === 0 ? "Lengkap" : `${s.missing} siswa belum bernilai`}</small></span>
      <button type="button" className={`button ${s.missing === 0 ? "secondary" : "primary"} small-button`} disabled={saving.busy} onClick={() => open(s.subjectId)}>{s.missing === 0 ? "Lihat nilai" : "Isi nilai"}</button>
    </li>)}</ul>
    <FormError text={saving.error} />
    <StepActions back={onBack}><button type="button" className="button primary" onClick={onNext}>Periksa & terbitkan<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

interface PublishProps { termId: string; classId: string; readiness: Readiness | null; onPublished: () => void; onBack: () => void; onClose: () => void }

function PublishStep({ termId, classId, readiness, onPublished, onBack, onClose }: PublishProps) {
  const { send } = useWizardApi();
  const { toast } = useHub();
  const [published, setPublished] = useState<number | null>(null);
  const saving = useSaving();
  if (!readiness) return <div className="skeleton" />;
  const plan = publishPlan(readiness);
  const publish = () => saving.run(async () => {
    const result = await send<{ publishedIds: string[] }>("/school/report-cards/publish", "POST", { termId, classId, studentIds: plan.studentIds });
    setPublished(result.publishedIds.length); onPublished(); toast(`${result.publishedIds.length} rapor terbit.`);
  });
  if (published !== null) return <>
    <StepIntro title="Rapor terbit" tone="success" why={`${published} rapor kini bisa dilihat siswa. Nilai, KKM, dan rekap kehadiran dikunci saat terbit; tarik terbit bila perlu memperbaiki.`} />
    <StepActions><button type="button" className="button primary" onClick={onClose}>Selesai</button></StepActions>
  </>;
  return <>
    <StepIntro title="Periksa & terbitkan" why="Hanya rapor yang semua mapelnya bernilai yang terbit; sisanya tetap draf sampai lengkap." />
    <div className="wizard-done-card"><strong>{plan.studentIds.length} rapor siap</strong><span>{plan.note}</span></div>
    {plan.blocked && <div className="warning-message" role="status">{plan.blocked}</div>}
    <FormError text={saving.error} />
    <StepActions back={onBack}><button type="button" className="button primary" disabled={Boolean(plan.blocked) || saving.busy} onClick={publish}>{saving.busy ? "Menerbitkan…" : `Terbitkan ${plan.studentIds.length} rapor`}</button></StepActions>
  </>;
}
