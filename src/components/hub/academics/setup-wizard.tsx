"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { currentYear, missingSemesters, SEMESTER_NAMES, setupSteps, type SetupStep, type YearView } from "@/lib/frontend/academics-rules";
import { gradeLabel } from "@/lib/schools/education-level";
import { Icon } from "../icon";
import { ClassForm, LevelForm, SubjectForm } from "./class-subject-forms";
import { Why } from "./form-kit";
import { GradeFixBanner } from "./grade-fix";
import { snapshotOf, useAcademics } from "./use-academics";
import { TermForm, YearForm } from "./year-term-forms";

/**
 * Panduan pengaturan akademik ala installation wizard: jalur langkah di kiri (atas di HP), isi langkah di
 * kanan. Langkah yang sudah beres menampilkan ringkasan + "Lanjut"; yang belum menampilkan formulirnya
 * langsung. Selesai -> tampilan tab.
 */
export function SetupWizard({ onFinish }: { onFinish: () => void }) {
  const { data } = useAcademics();
  const steps = setupSteps(snapshotOf(data));
  const firstOpen = steps.findIndex((step) => step.status === "todo");
  const [index, setIndex] = useState(firstOpen < 0 ? 0 : firstOpen);
  const step = steps[index]!;
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  // Pindah langkah = isi panel diganti; fokus dibawa ke judul langkah agar pembaca layar & keyboard tidak tersesat.
  useEffect(() => { if (moved.current) heading.current?.focus(); moved.current = true; }, [index]);
  const required = steps.filter((s) => s.status !== "optional" && s.key !== "subject");
  const doneCount = required.filter((s) => s.status === "done").length;
  const next = () => {
    const open = setupSteps(snapshotOf(data)).findIndex((s, i) => i > index && s.status === "todo");
    setIndex(open >= 0 ? open : Math.min(index + 1, steps.length - 1));
  };
  return <section className="setup-wizard panel" aria-label="Panduan pengaturan akademik">
    <header className="wizard-top">
      <div><span className="eyebrow">Panduan pengaturan</span><h2>Siapkan akademik sekolah</h2><p>{doneCount} dari {required.length} langkah wajib selesai. Urutannya penting: semester butuh tahun ajaran, siswa butuh kelas.</p></div>
      <div className="wizard-progress" role="progressbar" aria-label="Kemajuan langkah wajib" aria-valuemin={0} aria-valuemax={required.length} aria-valuenow={doneCount}><span style={{ width: `${(doneCount / Math.max(required.length, 1)) * 100}%` }} /></div>
    </header>
    <div className="wizard-body">
      <ol className="wizard-rail">{steps.map((s, i) => <li key={s.key}>
        <button type="button" className={`wizard-step ${s.status}${i === index ? " current" : ""}`} aria-current={i === index ? "step" : undefined} onClick={() => setIndex(i)}>
          <span className="step-mark" aria-hidden="true">{s.status === "done" ? <CheckMark size={16} /> : i + 1}</span>
          <span className="step-text"><strong>{s.title}{s.key === "subject" && <em className="step-optional">Opsional</em>}</strong><small>{s.summary}</small></span>
          <span className="sr-only">{s.status === "done" ? "selesai" : s.status === "optional" ? "opsional" : "belum selesai"}</span>
        </button>
      </li>)}</ol>
      <div className="wizard-pane" key={step.key}>
        <span className="eyebrow">Langkah {index + 1} dari {steps.length}</span>
        <h3 ref={heading} tabIndex={-1}>{step.title}</h3>
        <Why>{step.why}</Why>
        <StepBody step={step} onNext={next} onFinish={onFinish} goTo={(key) => setIndex(steps.findIndex((s) => s.key === key))} />
        {index > 0 && <button type="button" className="text-button wizard-back" onClick={() => setIndex(index - 1)}><Icon name="back" size={15} />Kembali ke {steps[index - 1]!.title.toLowerCase()}</button>}
      </div>
    </div>
  </section>;
}

/** Centang polos (ikon "check" bawaan berbingkai kotak, kurang cocok di dalam lingkaran). */
function CheckMark({ size }: { size: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

interface StepProps { readonly step: SetupStep; readonly onNext: () => void; readonly onFinish: () => void; readonly goTo: (key: SetupStep["key"]) => void }

function Done({ summary, children }: { summary: string; children?: ReactNode }) {
  return <div className="wizard-done"><span className="done-mark"><CheckMark size={18} /></span><div><strong>Sudah siap</strong><span>{summary}</span></div>{children}</div>;
}

/** Ringkasan langkah yang sudah beres + opsi menambah lagi tanpa meninggalkan wizard. */
function DoneOrForm({ step, onNext, addLabel, form }: { step: SetupStep; onNext: () => void; addLabel?: string; form: (close: () => void) => ReactNode }) {
  const [adding, setAdding] = useState(step.status === "todo");
  if (adding) return <>{form(() => setAdding(false))}</>;
  return <><Done summary={step.summary} /><div className="wizard-actions">{addLabel && <button type="button" className="button secondary" onClick={() => setAdding(true)}><Icon name="plus" size={16} />{addLabel}</button>}<button type="button" className="button primary" onClick={onNext}>Lanjut<Icon name="arrow" size={16} /></button></div></>;
}

function StepBody({ step, onNext, onFinish, goTo }: StepProps) {
  const { data, isSuperAdmin } = useAcademics();
  const year = currentYear(data.years, data.school.today);
  if (step.key === "level") {
    if (step.status === "done" && !isSuperAdmin) return <><Done summary={step.summary} /><div className="wizard-actions"><button type="button" className="button primary" onClick={onNext}>Lanjut<Icon name="arrow" size={16} /></button></div></>;
    return <DoneOrForm step={step} onNext={onNext} addLabel={isSuperAdmin ? "Ubah jenjang" : undefined} form={(close) => <LevelForm variant="inline" onDone={() => { close(); onNext(); }} />} />;
  }
  if (step.key === "year") return <DoneOrForm step={step} onNext={onNext} addLabel="Tahun ajaran lain" form={(close) => <YearForm variant="inline" onDone={() => { close(); onNext(); }} onCancel={step.status === "done" ? close : undefined} />} />;
  if (!year) return <NeedsYear goTo={goTo} />;
  if (step.key === "term") return <TermStep step={step} year={year} onNext={onNext} />;
  if (step.key === "class") return <ClassStep year={year} onNext={onNext} />;
  return <SubjectStep onFinish={onFinish} />;
}

function NeedsYear({ goTo }: { goTo: StepProps["goTo"] }) {
  return <><Why tone="warning">Langkah ini butuh tahun ajaran yang berjalan.</Why><div className="wizard-actions"><button type="button" className="button primary" onClick={() => goTo("year")}>Buat tahun ajaran</button></div></>;
}

function TermStep({ step, year, onNext }: { step: SetupStep; year: YearView; onNext: () => void }) {
  const missing = missingSemesters(year);
  return <DoneOrForm step={step} onNext={onNext} addLabel={missing[0] ? SEMESTER_NAMES[missing[0]] : undefined} form={(close) => <TermForm variant="inline" year={year} onDone={() => { close(); onNext(); }} onCancel={step.status === "done" ? close : undefined} />} />;
}

function ClassStep({ year, onNext }: { year: YearView; onNext: () => void }) {
  const { data } = useAcademics();
  const classes = data.classes.filter((c) => c.academicYearId === year.id);
  return <>
    {classes.length > 0 && <div className="chip-list" aria-label={`Kelas di ${year.name}`}>{classes.map((c) => <span key={c.id} className="pill">{c.name}<small>{gradeLabel(data.school.educationLevel, c.gradeLevel)}</small></span>)}</div>}
    <GradeFixBanner yearId={year.id} />
    <ClassForm variant="inline" yearId={year.id} quiet={classes.length > 0} onDone={() => undefined} />
    {classes.length > 0 && <div className="wizard-actions"><span className="muted">Tambah semua kelas sekarang atau nanti lewat tab Kelas.</span><button type="button" className="button primary" onClick={onNext}>Lanjut<Icon name="arrow" size={16} /></button></div>}
  </>;
}

function SubjectStep({ onFinish }: { onFinish: () => void }) {
  const { data } = useAcademics();
  const subjects = data.subjects.filter((s) => s.isActive);
  return <>
    {subjects.length > 0 && <div className="chip-list" aria-label="Mata pelajaran aktif">{subjects.map((s) => <span key={s.id} className="pill">{s.code}<small>{s.name}</small></span>)}</div>}
    <SubjectForm variant="inline" quiet={subjects.length > 0} onDone={() => undefined} />
    <div className="wizard-actions"><span className="muted">{subjects.length ? "Mapel bisa dipetakan ke kelas lewat tab Kelas." : "Boleh dilewati; isi nanti sebelum mengisi rapor."}</span><button type="button" className="button primary" onClick={onFinish}>{subjects.length ? "Selesai" : "Lewati & selesai"}<Icon name="check" size={16} /></button></div>
  </>;
}
