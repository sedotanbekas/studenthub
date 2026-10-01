"use client";
import { useState } from "react";
import { findOverlappingYear, validateAcademicYear, validateTerm, validateYearContainsTerms, type SemesterCode } from "@/lib/academics/rules";
import type { DateRange } from "@/lib/calendar/ranges";
import {
  dateRangeText, dateText, missingSemesters, preferredSemester, SEMESTER_NAMES, suggestTermRange, suggestYearName, suggestYearRange, termBounds, termSealNotice,
  type TermView, type YearView,
} from "@/lib/frontend/academics-rules";
import { DeleteButton, FormError, FormFooter, FormFrame, Why, type FormVariant } from "./form-kit";
import { useAcademics, useSaving } from "./use-academics";

interface YearFormProps { readonly variant: FormVariant; readonly year?: YearView; readonly onDone: () => void; readonly onCancel?: () => void }

function yearProblem(name: string, range: DateRange, others: readonly YearView[], year?: YearView): string | null {
  if (!range.startDate || !range.endDate) return "Isi tanggal mulai dan tanggal selesai.";
  const violation = validateAcademicYear({ name: name.trim(), ...range });
  if (violation) return violation.message;
  if (others.some((other) => other.name === name.trim())) return `Tahun ajaran ${name.trim()} sudah ada.`;
  const overlap = findOverlappingYear(range, others);
  if (overlap) return `Tanggalnya beririsan dengan tahun ajaran ${overlap.name}. Satu tanggal hanya boleh masuk satu tahun ajaran.`;
  return year ? validateYearContainsTerms(range, year.terms)?.message ?? null : null;
}

export function YearForm({ variant, year, onDone, onCancel }: YearFormProps) {
  const { data, mutate, reload, toast, canManage } = useAcademics();
  const initialName = year?.name ?? suggestYearName(data.school.today);
  const [name, setName] = useState(initialName);
  const [range, setRange] = useState<DateRange>(() => (year ? { startDate: year.startDate, endDate: year.endDate } : suggestYearRange(initialName) ?? { startDate: "", endDate: "" }));
  const [datesTouched, setDatesTouched] = useState(Boolean(year));
  const [armed, setArmed] = useState(false);
  const saving = useSaving();
  const others = data.years.filter((other) => other.id !== year?.id);
  const problem = yearProblem(name, range, others, year);
  const inUse = year && (year.terms.length > 0 || data.classes.some((c) => c.academicYearId === year.id));
  const changeName = (value: string) => {
    setName(value);
    const suggested = datesTouched ? null : suggestYearRange(value);
    if (suggested) setRange(suggested);
  };
  const changeDate = (key: keyof DateRange, value: string) => { setDatesTouched(true); setRange((current) => ({ ...current, [key]: value })); };
  const submit = () => saving.run(async () => {
    if (problem) throw new Error(problem);
    const body = { name: name.trim(), ...range };
    await (year ? mutate(`/school/academic-years/${year.id}`, "PATCH", body) : mutate("/school/academic-years", "POST", body));
    await reload();
    toast(year ? "Tahun ajaran diperbarui." : `Tahun ajaran ${body.name} dibuat.`);
    onDone();
  });
  const remove = () => saving.run(async () => { await mutate(`/school/academic-years/${year!.id}`, "DELETE"); await reload(); toast(`Tahun ajaran ${year!.name} dihapus.`); onDone(); });
  const extra = year && canManage ? <DeleteButton label="Hapus" busy={saving.busy} armed={armed} onArm={() => setArmed(true)} onConfirm={remove} blockedReason={inUse ? "Sudah punya semester atau kelas." : null} /> : undefined;
  return <FormFrame variant={variant} onSubmit={submit} footer={<FormFooter busy={saving.busy} disabled={!canManage} onCancel={onCancel} extra={extra} submitLabel={year ? "Simpan perubahan" : variant === "inline" ? "Simpan & lanjut" : "Buat tahun ajaran"} />}>
    <div className="form-grid">
      <label className="field full-width">Nama tahun ajaran<input value={name} onChange={(e) => changeName(e.target.value)} placeholder="2026/2027" autoComplete="off" required /><span className="field-hint">Format TTTT/TTTT, misalnya 2026/2027. Tanggal terisi otomatis dan bisa diubah.</span></label>
      <label className="field">Tanggal mulai<input type="date" value={range.startDate} onChange={(e) => changeDate("startDate", e.target.value)} required /></label>
      <label className="field">Tanggal selesai<input type="date" min={range.startDate} value={range.endDate} onChange={(e) => changeDate("endDate", e.target.value)} required /></label>
    </div>
    {problem && name.trim() ? <p className="field-error" role="status">{problem}</p> : <Why>Semester dan kelas dibuat di dalam tahun ajaran ini, jadi tanggalnya membatasi semester.</Why>}
    <FormError text={saving.error} />
  </FormFrame>;
}

interface TermFormProps { readonly variant: FormVariant; readonly year: YearView; readonly term?: TermView; readonly semester?: SemesterCode; readonly onDone: () => void; readonly onCancel?: () => void }

/** Kalimat dampak rentang semester terhadap absensi hari ini (sebab-akibat singkat). */
function useTermEffect(year: YearView, semester: SemesterCode, range: DateRange, term?: TermView): { problem: string | null; effect: { tone: "info" | "warning" | "success"; text: string } } {
  const { data } = useAcademics();
  const { today, timezone, checkInCloseMinute } = data.school;
  const sibling = year.terms.find((other) => other.semester !== semester && other.id !== term?.id);
  const violation = range.startDate && range.endDate ? validateTerm({ semester, ...range }, year, sibling ?? null) : { message: "Isi tanggal mulai dan tanggal selesai." };
  const seal = termSealNotice({ before: term ?? null, after: range, now: new Date(), timezone, checkInCloseMinute });
  if (seal) return { problem: violation?.message ?? null, effect: { tone: "warning", text: seal } };
  if (range.startDate <= today && today <= range.endDate) return { problem: violation?.message ?? null, effect: { tone: "success", text: "Mencakup hari ini, jadi siswa bisa absen begitu disimpan." } };
  const text = range.startDate > today ? `Absensi semester ini berjalan mulai ${dateText(range.startDate)}.` : "Rentang ini sudah lewat; hari ini tetap belum masuk semester.";
  return { problem: violation?.message ?? null, effect: { tone: range.startDate > today ? "info" : "warning", text } };
}

export function TermForm({ variant, year, term, semester: chosen, onDone, onCancel }: TermFormProps) {
  const { data, mutate, reload, toast, canManage } = useAcademics();
  const choices = term ? [term.semester] : missingSemesters(year);
  const [semester, setSemester] = useState<SemesterCode>(term?.semester ?? chosen ?? preferredSemester(year, data.school.today) ?? "GANJIL");
  const [range, setRange] = useState<DateRange>(() => (term ? { startDate: term.startDate, endDate: term.endDate } : suggestTermRange(year, semester)));
  const [armed, setArmed] = useState(false);
  const saving = useSaving();
  const bounds = termBounds(year, semester);
  const { problem, effect } = useTermEffect(year, semester, range, term);
  const hasActive = data.years.some((y) => y.terms.some((t) => t.isActive));
  const pickSemester = (value: SemesterCode) => { setSemester(value); setRange(suggestTermRange(year, value)); };
  const save = async () => {
    if (term) { await mutate(`/school/terms/${term.id}`, "PATCH", range); return; }
    const created = (await mutate(`/school/academic-years/${year.id}/terms`, "POST", { semester, ...range })) as TermView;
    if (!hasActive) await mutate("/school/active-term", "PUT", { termId: created.id });
  };
  const submit = () => saving.run(async () => {
    if (problem) throw new Error(problem);
    // Dua langkah (buat + jadikan aktif): data tetap dimuat ulang bila langkah kedua gagal agar tampilan tidak basi.
    try { await save(); } finally { await reload().catch(() => undefined); }
    toast(term ? "Semester diperbarui." : hasActive ? `${SEMESTER_NAMES[semester]} dibuat.` : `${SEMESTER_NAMES[semester]} dibuat dan dijadikan semester aktif.`);
    onDone();
  });
  const remove = () => saving.run(async () => { await mutate(`/school/terms/${term!.id}`, "DELETE"); await reload(); toast(`${term!.label} dihapus.`); onDone(); });
  const extra = term && canManage ? <DeleteButton label="Hapus" busy={saving.busy} armed={armed} onArm={() => setArmed(true)} onConfirm={remove} blockedReason={term.isActive ? "Semester aktif. Jadikan semester lain aktif dulu." : null} /> : undefined;
  return <FormFrame variant={variant} onSubmit={submit} footer={<FormFooter busy={saving.busy} disabled={!canManage || choices.length === 0} onCancel={onCancel} extra={extra} submitLabel={term ? "Simpan perubahan" : variant === "inline" ? "Simpan & lanjut" : "Buat semester"} />}>
    <div className="form-grid">
      {choices.length > 1
        ? <fieldset className="field full-width acad-segmented"><legend>Semester</legend>{choices.map((value) => <label key={value} className={semester === value ? "selected" : ""}><input type="radio" name="semester" value={value} checked={semester === value} onChange={() => pickSemester(value)} />{SEMESTER_NAMES[value]}</label>)}</fieldset>
        : <p className="field full-width">Semester<strong className="acad-static">{SEMESTER_NAMES[semester]} {year.name}</strong></p>}
      <label className="field">Tanggal mulai<input type="date" min={bounds.min} max={bounds.max} value={range.startDate} onChange={(e) => setRange((r) => ({ ...r, startDate: e.target.value }))} required /></label>
      <label className="field">Tanggal selesai<input type="date" min={range.startDate || bounds.min} max={bounds.max} value={range.endDate} onChange={(e) => setRange((r) => ({ ...r, endDate: e.target.value }))} required /></label>
    </div>
    <p className="field-hint acad-bounds">Pilihan tanggal dibatasi {dateRangeText(bounds.min, bounds.max)}: di dalam tahun ajaran {year.name}{year.terms.some((t) => t.semester !== semester) ? " dan tidak menabrak semester lainnya" : ""}.</p>
    {problem ? <p className="field-error" role="status">{problem}</p> : <Why tone={effect.tone}>{effect.text}</Why>}
    <FormError text={saving.error} />
  </FormFrame>;
}
