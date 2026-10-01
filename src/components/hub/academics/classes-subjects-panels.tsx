"use client";
import { gradeIssue } from "@/lib/frontend/academics-rules";
import { EDUCATION_LEVEL_LABELS, gradeLabel } from "@/lib/schools/education-level";
import { number } from "@/lib/frontend/format";
import { Icon } from "../icon";
import type { DialogState } from "./academics-dialogs";
import { GradeFixBanner } from "./grade-fix";
import { useAcademics } from "./use-academics";

const ActiveStatus = ({ active }: { active: boolean }) => <span className={`status ${active ? "green" : "neutral"}`}><i />{active ? "Aktif" : "Nonaktif"}</span>;

/** Tab "Kelas": daftar per tahun ajaran (tahun dipilih di atas, bukan diulang di tiap baris). */
export function ClassesPanel({ yearId, onYear, onOpen }: { yearId: string; onYear: (id: string) => void; onOpen: (dialog: DialogState) => void }) {
  const { data, canManage } = useAcademics();
  const level = data.school.educationLevel;
  const years = [...data.years].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const year = years.find((y) => y.id === yearId) ?? years[0];
  const classes = year ? data.classes.filter((c) => c.academicYearId === year.id) : [];
  return <section className="panel acad-panel" aria-labelledby="classes-title">
    <div className="acad-panel-head">
      <div><h2 id="classes-title">Kelas</h2><p className="muted">Siswa ditempatkan di kelas; setiap kelas milik satu tahun ajaran.</p></div>
      <div className="acad-head-actions">
        {years.length > 0 && <label className="acad-year-select"><span>Tahun ajaran</span><select value={year?.id ?? ""} onChange={(e) => onYear(e.target.value)}>{years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>}
        {canManage && year && <button type="button" className="button primary" onClick={() => onOpen({ kind: "class", yearId: year.id })}><Icon name="plus" size={17} />Kelas baru</button>}
      </div>
    </div>
    {!level && <div className="info-message acad-inline-notice"><Icon name="spark" size={18} /><span className="notice-text">Jenjang sekolah belum diisi, jadi tingkat tampil sebagai kelas 1–12.</span>{canManage && <button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "level" })}>Isi jenjang</button>}</div>}
    {year && <GradeFixBanner yearId={year.id} />}
    {!year ? <EmptyRow icon="calendar" title="Belum ada tahun ajaran" text="Buat tahun ajaran di tab pertama; kelas dibuat di dalamnya." />
      : classes.length === 0 ? <EmptyRow icon="users" title={`Belum ada kelas di ${year.name}`} text="Siswa baru bisa diaktifkan setelah ditempatkan di kelas." />
      : <div className="table-scroll"><table className="acad-table">
        <thead><tr><th scope="col">Nama kelas</th><th scope="col">Tingkat</th><th scope="col">Siswa aktif</th><th scope="col">Mapel</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Tindakan</span></th></tr></thead>
        <tbody>{classes.map((cls) => {
          const issue = gradeIssue(level, cls);
          return <tr key={cls.id}>
            <td><strong>{cls.name}</strong></td>
            <td>{gradeLabel(level, cls.gradeLevel)}{issue && <small className="cell-warning">Di luar jenjang {level ? EDUCATION_LEVEL_LABELS[level] : ""}</small>}</td>
            <td>{number(cls.activeStudentCount)}</td>
            <td>{cls.subjectCount === 0 ? <span className="muted">Belum ada</span> : `${number(cls.subjectCount)} mapel`}</td>
            <td><ActiveStatus active={cls.isActive} /></td>
            <td className="row-actions">{canManage && <><button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "subjects", cls })}>Atur mapel</button><button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "class", cls })}>Ubah</button></>}</td>
          </tr>;
        })}</tbody>
      </table></div>}
  </section>;
}

/** Tab "Mata pelajaran": master mapel sekolah (dipetakan ke kelas lewat tab Kelas). */
export function SubjectsPanel({ onOpen }: { onOpen: (dialog: DialogState) => void }) {
  const { data, canManage } = useAcademics();
  return <section className="panel acad-panel" aria-labelledby="subjects-title">
    <div className="acad-panel-head">
      <div><h2 id="subjects-title">Mata pelajaran</h2><p className="muted">Opsional untuk absensi; dibutuhkan untuk nilai dan rapor.</p></div>
      {canManage && <button type="button" className="button primary" onClick={() => onOpen({ kind: "subject" })}><Icon name="plus" size={17} />Mapel baru</button>}
    </div>
    {data.subjects.length === 0 ? <EmptyRow icon="book" title="Belum ada mata pelajaran" text="Tambahkan mapel, lalu petakan ke kelas lewat tombol Atur mapel di tab Kelas." />
      : <div className="table-scroll"><table className="acad-table">
        <thead><tr><th scope="col">Kode</th><th scope="col">Mata pelajaran</th><th scope="col">KKM</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Tindakan</span></th></tr></thead>
        <tbody>{data.subjects.map((subject) => <tr key={subject.id}>
          <td><span className="pill">{subject.code}</span></td>
          <td><strong>{subject.name}</strong></td>
          <td>{subject.kkm}</td>
          <td><ActiveStatus active={subject.isActive} /></td>
          <td className="row-actions">{canManage && <button type="button" className="button secondary small-button" onClick={() => onOpen({ kind: "subject", subject })}>Ubah</button>}</td>
        </tr>)}</tbody>
      </table></div>}
  </section>;
}

function EmptyRow({ icon, title, text }: { icon: string; title: string; text: string }) {
  return <div className="empty-state compact"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{text}</p></div>;
}
