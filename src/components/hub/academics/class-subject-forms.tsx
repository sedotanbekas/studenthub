"use client";
import { useEffect, useState } from "react";
import { isValidSubjectCode, normalizeName, normalizeSubjectCode } from "@/lib/academics/rules";
import { currentYear, gradeIssue, type ClassView, type SubjectView } from "@/lib/frontend/academics-rules";
import { EDUCATION_LEVEL_LABELS, EDUCATION_LEVEL_NAMES, gradeLabel, gradeOptions, isGradeInLevel, type EducationLevel } from "@/lib/schools/education-level";
import { DeleteButton, FormError, FormFooter, FormFrame, Why, type FormVariant } from "./form-kit";
import { useAcademics, useSaving } from "./use-academics";

const LEVEL_GROUPS: readonly (readonly [string, readonly EducationLevel[]])[] = [
  ["Pendidikan dasar · kelas 1–6", ["SD", "MI"]],
  ["Menengah pertama · kelas 7–9", ["SMP", "MTS"]],
  ["Menengah atas · kelas 10–12", ["SMA", "MA", "SMK", "MAK"]],
];

interface Props { readonly variant: FormVariant; readonly onDone: () => void; readonly onCancel?: () => void }

export function LevelForm({ variant, onDone, onCancel }: Props) {
  const { data, mutate, reload, toast, canManage, isSuperAdmin } = useAcademics();
  const current = data.school.educationLevel;
  const [level, setLevel] = useState<EducationLevel | null>(current);
  const saving = useSaving();
  const locked = current !== null && !isSuperAdmin;
  const outside = level ? data.classes.filter((c) => !isGradeInLevel(level, c.gradeLevel)).length : 0;
  const submit = () => saving.run(async () => {
    if (!level) throw new Error("Pilih jenjang sekolah.");
    await mutate("/school/settings", "PATCH", { educationLevel: level });
    await reload();
    toast(`Jenjang sekolah: ${EDUCATION_LEVEL_LABELS[level]}.`);
    onDone();
  });
  return <FormFrame variant={variant} onSubmit={submit} footer={<FormFooter busy={saving.busy} disabled={!canManage || locked || !level} onCancel={onCancel} submitLabel={variant === "inline" ? "Simpan & lanjut" : "Simpan jenjang"} />}>
    {LEVEL_GROUPS.map(([title, levels]) => <fieldset key={title} className="level-group" disabled={locked}>
      <legend>{title}</legend>
      <div className="level-options">{levels.map((value) => <label key={value} className={`level-card${level === value ? " selected" : ""}`}>
        <input type="radio" name="educationLevel" value={value} checked={level === value} onChange={() => setLevel(value)} />
        <strong>{EDUCATION_LEVEL_LABELS[value]}</strong><small>{EDUCATION_LEVEL_NAMES[value]}</small>
      </label>)}</div>
    </fieldset>)}
    {outside > 0 && <Why tone="warning">{outside} kelas tersimpan dengan tingkat di luar jenjang ini; setelah disimpan, perbaikannya ditawarkan sekali klik.</Why>}
    <Why>{locked ? "Jenjang sudah diatur. Hubungi super admin studenthub.id bila perlu diubah." : "Setelah disimpan, jenjang hanya bisa diubah oleh super admin studenthub.id."}</Why>
    <FormError text={saving.error} />
  </FormFrame>;
}

interface ClassFormProps extends Props { readonly cls?: ClassView; readonly yearId?: string; readonly quiet?: boolean }

/** Pilihan tingkat sesuai jenjang; kelas lama di luar jenjang tetap tampil agar tidak diam-diam berubah. */
function classGradeOptions(level: EducationLevel | null, current?: number): { value: number; label: string }[] {
  const options = gradeOptions(level);
  return current === undefined || options.some((o) => o.value === current) ? options : [{ value: current, label: `${gradeLabel(null, current)} (di luar jenjang)` }, ...options];
}

export function ClassForm({ variant, cls, yearId, quiet, onDone, onCancel }: ClassFormProps) {
  const { data, mutate, reload, toast, canManage } = useAcademics();
  const level = data.school.educationLevel;
  const issue = cls ? gradeIssue(level, cls) : null;
  const [academicYearId, setYearId] = useState(cls?.academicYearId ?? yearId ?? currentYear(data.years, data.school.today)?.id ?? "");
  const [name, setName] = useState(cls?.name ?? "");
  const [grade, setGrade] = useState<number>(issue?.fixTo ?? cls?.gradeLevel ?? gradeOptions(level)[0]!.value);
  const [isActive, setActive] = useState(cls?.isActive ?? true);
  const [armed, setArmed] = useState(false);
  const saving = useSaving();
  const clean = normalizeName(name);
  const taken = data.classes.some((c) => c.academicYearId === academicYearId && c.id !== cls?.id && c.name.toLowerCase() === clean.toLowerCase());
  const problem = !academicYearId ? "Buat tahun ajaran dulu." : !clean ? "Isi nama kelas." : taken ? `Nama "${clean}" sudah dipakai di tahun ajaran ini.` : null;
  const submit = () => saving.run(async () => {
    if (problem) throw new Error(problem);
    if (cls) await mutate(`/school/classes/${cls.id}`, "PATCH", { name: clean, gradeLevel: grade, isActive });
    else await mutate("/school/classes", "POST", { academicYearId, name: clean, gradeLevel: grade });
    await reload();
    toast(cls ? `Kelas ${clean} diperbarui.` : `Kelas ${clean} dibuat.`);
    if (!cls) setName("");
    onDone();
  });
  const remove = () => saving.run(async () => { await mutate(`/school/classes/${cls!.id}`, "DELETE"); await reload(); toast(`Kelas ${cls!.name} dihapus.`); onDone(); });
  const extra = cls && canManage ? <DeleteButton label="Hapus" busy={saving.busy} armed={armed} onArm={() => setArmed(true)} onConfirm={remove} blockedReason={cls.activeStudentCount > 0 ? "Masih ada siswa aktif." : null} /> : undefined;
  return <FormFrame variant={variant} onSubmit={submit} footer={<FormFooter busy={saving.busy} disabled={!canManage} onCancel={onCancel} extra={extra} quiet={quiet} submitLabel={cls ? "Simpan perubahan" : "Tambah kelas"} />}>
    <div className="form-grid">
      {!cls && data.years.length > 1 && <label className="field full-width">Tahun ajaran<select value={academicYearId} onChange={(e) => setYearId(e.target.value)}>{data.years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>}
      <label className="field">Nama kelas<input value={name} onChange={(e) => setName(e.target.value)} placeholder="mis. XII TKJ 1" autoComplete="off" required /></label>
      <label className="field">Tingkat<select value={grade} onChange={(e) => setGrade(Number(e.target.value))}>{classGradeOptions(level, cls?.gradeLevel).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
      {cls && <label className="check-field"><input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} /><span>Kelas aktif<small>Kelas nonaktif tidak bisa menerima siswa baru. Kelas yang masih punya siswa aktif tidak bisa dinonaktifkan.</small></span></label>}
    </div>
    {issue && <Why tone="warning">{issue.text}{issue.fixTo !== null ? " Pilihan tingkat sudah disesuaikan; tinggal simpan." : ""}</Why>}
    {problem && clean ? <p className="field-error" role="status">{problem}</p> : <Why>{level ? `Tingkat ditampilkan relatif jenjang ${EDUCATION_LEVEL_LABELS[level]}; tersimpan sebagai kelas nasional.` : "Jenjang sekolah belum diisi, jadi tingkat memakai kelas 1–12."}</Why>}
    <FormError text={saving.error} />
  </FormFrame>;
}

interface SubjectFormProps extends Props { readonly subject?: SubjectView; readonly quiet?: boolean }

export function SubjectForm({ variant, subject, quiet, onDone, onCancel }: SubjectFormProps) {
  const { data, mutate, reload, toast, canManage } = useAcademics();
  const [code, setCode] = useState(subject?.code ?? "");
  const [name, setName] = useState(subject?.name ?? "");
  const [kkm, setKkm] = useState(String(subject?.kkm ?? 75));
  const [isActive, setActive] = useState(subject?.isActive ?? true);
  const [armed, setArmed] = useState(false);
  const saving = useSaving();
  const cleanCode = normalizeSubjectCode(code);
  const kkmValue = Number(kkm);
  const problem = !isValidSubjectCode(cleanCode) ? "Kode 1–20 huruf kapital/angka, mis. MTK." : data.subjects.some((s) => s.code === cleanCode && s.id !== subject?.id) ? `Kode ${cleanCode} sudah dipakai.` : normalizeName(name).length < 2 ? "Nama mapel minimal 2 karakter." : !Number.isInteger(kkmValue) || kkmValue < 0 || kkmValue > 100 ? "KKM 0–100." : null;
  const submit = () => saving.run(async () => {
    if (problem) throw new Error(problem);
    const body = { code: cleanCode, name: normalizeName(name), kkm: kkmValue };
    await (subject ? mutate(`/school/subjects/${subject.id}`, "PATCH", { ...body, isActive }) : mutate("/school/subjects", "POST", body));
    await reload();
    toast(subject ? `Mapel ${body.name} diperbarui.` : `Mapel ${body.name} ditambahkan.`);
    if (!subject) { setCode(""); setName(""); }
    onDone();
  });
  const remove = () => saving.run(async () => { await mutate(`/school/subjects/${subject!.id}`, "DELETE"); await reload(); toast(`Mapel ${subject!.name} dihapus.`); onDone(); });
  const extra = subject && canManage ? <DeleteButton label="Hapus" busy={saving.busy} armed={armed} onArm={() => setArmed(true)} onConfirm={remove} /> : undefined;
  return <FormFrame variant={variant} onSubmit={submit} footer={<FormFooter busy={saving.busy} disabled={!canManage} onCancel={onCancel} extra={extra} quiet={quiet} submitLabel={subject ? "Simpan perubahan" : "Tambah mapel"} />}>
    <div className="form-grid acad-subject-grid">
      <label className="field">Kode<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="MTK" maxLength={20} autoComplete="off" required /></label>
      <label className="field">Nama mata pelajaran<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Matematika" maxLength={100} required /></label>
      <label className="field">KKM<input type="number" inputMode="numeric" min={0} max={100} value={kkm} onChange={(e) => setKkm(e.target.value)} required /></label>
      {subject && <label className="check-field"><input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} /><span>Mapel aktif<small>Mapel nonaktif tidak bisa dipetakan ke kelas baru.</small></span></label>}
    </div>
    {problem && (code || name) ? <p className="field-error" role="status">{problem}</p> : <Why>KKM = nilai minimum tuntas; dipakai untuk predikat di rapor.</Why>}
    <FormError text={saving.error} />
  </FormFrame>;
}

interface ClassSubjectsDto { readonly subjects: readonly { readonly subjectId: string }[] }

/** Centang mapel yang diajarkan di satu kelas (PUT mengganti seluruh pemetaan). */
export function ClassSubjectsForm({ cls, onDone, onCancel }: { cls: ClassView; onDone: () => void; onCancel: () => void }) {
  const { data, mutate, reload, toast, canManage, get } = useAcademics();
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  // Gagal memuat = pemetaan lama tidak diketahui; simpan tetap terkunci agar pemetaan lama tidak tertimpa kosong.
  const [loadFailed, setLoadFailed] = useState(false);
  const saving = useSaving();
  const { setError } = saving;
  const subjects = data.subjects.filter((s) => s.isActive || selected?.has(s.id));
  useEffect(() => {
    let active = true;
    get<ClassSubjectsDto>(`/school/classes/${cls.id}/subjects`).then((dto) => { if (active) setSelected(new Set(dto.subjects.map((s) => s.subjectId))); }).catch((e: unknown) => { if (active) { setLoadFailed(true); setError(e instanceof Error ? e.message : "Mapel kelas belum berhasil dimuat. Tutup lalu buka lagi."); } });
    return () => { active = false; };
  }, [cls.id, get, setError]);
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const submit = () => saving.run(async () => {
    const subjectIds = data.subjects.filter((s) => selected?.has(s.id)).map((s) => s.id);
    await mutate(`/school/classes/${cls.id}/subjects`, "PUT", { subjectIds });
    await reload();
    toast(`${subjectIds.length} mapel dipetakan ke ${cls.name}.`);
    onDone();
  });
  return <FormFrame variant="dialog" onSubmit={submit} footer={<FormFooter busy={saving.busy} disabled={!canManage || selected === null} onCancel={onCancel} submitLabel="Simpan mapel kelas" />}>
    {selected === null ? (loadFailed ? null : <div className="skeleton" />) : subjects.length === 0 ? <Why tone="warning">Belum ada mapel aktif. Tambahkan dulu di tab Mata pelajaran.</Why>
      : <div className="acad-check-list">{subjects.map((s) => <label key={s.id} className="check-field"><input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} /><span>{s.name}<small>{s.code} · KKM {s.kkm}</small></span></label>)}</div>}
    <Why>Mapel yang dicentang muncul di lembar nilai dan rapor kelas ini.</Why>
    <FormError text={saving.error} />
  </FormFrame>;
}
