"use client";
import { dateRangeText, SEMESTER_NAMES, SEMESTERS, type TermView, type YearView } from "@/lib/frontend/academics-rules";
import { Icon } from "../icon";
import type { DialogState } from "./academics-dialogs";
import { FormError } from "./form-kit";
import { useAcademics, useSaving } from "./use-academics";

interface PanelProps { readonly onOpen: (dialog: DialogState) => void; readonly onShowClasses: (yearId: string) => void }

const covers = (range: { startDate: string; endDate: string }, date: string) => range.startDate <= date && date <= range.endDate;

/** Tab "Tahun ajaran & semester": satu kartu per tahun ajaran, berisi slot Ganjil & Genap. */
export function YearsPanel({ onOpen, onShowClasses }: PanelProps) {
  const { data, canManage } = useAcademics();
  const years = [...data.years].sort((a, b) => b.startDate.localeCompare(a.startDate));
  return <section className="panel acad-panel" aria-labelledby="years-title">
    <div className="acad-panel-head">
      <div><h2 id="years-title">Tahun ajaran & semester</h2><p className="muted">Absensi hanya berjalan pada tanggal yang masuk semester.</p></div>
      {canManage && <button type="button" className="button primary" onClick={() => onOpen({ kind: "year" })}><Icon name="plus" size={17} />Tahun ajaran baru</button>}
    </div>
    {years.length === 0
      ? <div className="empty-state compact"><span className="empty-icon"><Icon name="calendar" size={28} /></span><h3>Belum ada tahun ajaran</h3><p>Buat tahun ajaran dulu; semester dan kelas dibuat di dalamnya.</p></div>
      : <div className="year-list">{years.map((year) => <YearCard key={year.id} year={year} onOpen={onOpen} onShowClasses={onShowClasses} />)}</div>}
  </section>;
}

function YearCard({ year, onOpen, onShowClasses }: PanelProps & { year: YearView }) {
  const { data, canManage } = useAcademics();
  const classCount = data.classes.filter((c) => c.academicYearId === year.id).length;
  const running = covers(year, data.school.today);
  return <article className={`year-card${running ? " running" : ""}`}>
    <header>
      <div><h3>{year.name}{running && <span className="status green"><i />Berjalan</span>}</h3><p className="muted">{dateRangeText(year.startDate, year.endDate)}</p></div>
      {canManage && <button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "year", year })}>Ubah</button>}
    </header>
    <ul className="term-slots">{SEMESTERS.map((semester) => {
      const term = year.terms.find((t) => t.semester === semester);
      if (term) return <TermRow key={semester} year={year} term={term} onOpen={onOpen} />;
      return <li key={semester} className="term-slot empty"><span><strong>{SEMESTER_NAMES[semester]}</strong><small>Belum dibuat</small></span>
        {canManage && <button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "term", year, semester })}><Icon name="plus" size={15} />{SEMESTER_NAMES[semester]}</button>}</li>;
    })}</ul>
    <footer><span className="muted">{classCount} kelas</span><button type="button" className="text-button" onClick={() => onShowClasses(year.id)}>Lihat kelas<Icon name="arrow" size={15} /></button></footer>
  </article>;
}

interface ActiveTermResult { readonly activeStudentsOutsideYear?: number }

function TermRow({ year, term, onOpen }: { year: YearView; term: TermView; onOpen: PanelProps["onOpen"] }) {
  const { data, canManage, mutate, reload, toast } = useAcademics();
  const saving = useSaving();
  const today = covers(term, data.school.today);
  const activate = () => saving.run(async () => {
    const result = (await mutate("/school/active-term", "PUT", { termId: term.id })) as ActiveTermResult;
    await reload();
    const outside = result.activeStudentsOutsideYear ?? 0;
    toast(outside > 0 ? `${term.label} aktif. ${outside} siswa aktif masih di kelas tahun ajaran lain; pindahkan kelasnya.` : `${term.label} jadi semester aktif untuk rapor & daftar kelas.`);
  });
  return <li className={`term-slot${term.isActive ? " active" : ""}`}>
    <span><strong>{SEMESTER_NAMES[term.semester]}</strong><small>{dateRangeText(term.startDate, term.endDate)}</small></span>
    <span className="term-badges">{term.isActive && <span className="status green"><i />Semester aktif</span>}{today && <span className="pill">Hari ini</span>}</span>
    {canManage && <span className="term-actions">
      {!term.isActive && <button type="button" className="button secondary small-button" disabled={saving.busy} onClick={activate} title="Semester aktif dipakai untuk rapor dan daftar kelas bawaan">Jadikan aktif</button>}
      <button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "term", year, term })}>Ubah</button>
    </span>}
    <FormError text={saving.error} />
  </li>;
}
