"use client";
import { useState } from "react";
import { downloadApiFile, scoped } from "@/lib/frontend/api";
import { credentialsCsv, importFileProblem, importSummary, problemRows, type Credential, type ImportReport } from "@/lib/frontend/wizard-rules";
import { FormError } from "../academics/form-kit";
import { useSaving } from "../academics/use-academics";
import { useHub } from "../context";
import { Icon } from "../icon";
import { DEFAULT_STUDENT_PASSWORD } from "@/lib/students/constants";
import { DEMO_BLOCKED, saveTextFile, StepActions, StepIntro, useWizardApi, WizardDialog, type CustomActionProps } from "./wizard-kit";

/** Wizard impor siswa: templat -> unggah & periksa (dry-run) -> simpan (semua atau tidak sama sekali) -> kata sandi awal. */
interface ImportResult { readonly dryRun: boolean; readonly report: ImportReport; readonly created?: number; readonly credentials?: readonly Credential[] }

const STEPS = [{ key: "template", title: "Unduh templat" }, { key: "upload", title: "Unggah & periksa" }, { key: "save", title: "Simpan" }, { key: "passwords", title: "Kata sandi awal" }];
const IMPORT_PATH = "/school/students/import";

export function ImportStudentsWizard({ onClose, onDone, onFallback }: CustomActionProps) {
  const { toast } = useHub();
  const { send } = useWizardApi();
  const [index, setIndex] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [activate, setActivate] = useState(true);
  const [releaseNisn, setReleaseNisn] = useState(false);
  const [check, setCheck] = useState<ImportResult | null>(null);
  const [saved, setSaved] = useState<ImportResult | null>(null);
  const saving = useSaving();
  const reachable = saved ? 3 : check && importSummary(check.report).canSave ? 2 : 1;
  const formData = (dryRun: boolean): FormData => {
    const data = new FormData();
    data.set("file", file!); data.set("dryRun", String(dryRun)); data.set("activate", String(activate));
    if (releaseNisn) data.set("confirmReleaseGraduatedNisn", "true");
    return data;
  };
  const pick = (next: File | null) => { setFile(next); setCheck(null); saving.setError(next ? importFileProblem(next) ?? "" : ""); };
  const runCheck = () => saving.run(async () => {
    const problem = file ? importFileProblem(file) : "Pilih berkas Excel/CSV dulu.";
    if (problem) throw new Error(problem);
    setCheck(await send<ImportResult>(IMPORT_PATH, "POST", formData(true)));
  });
  const runSave = () => saving.run(async () => {
    const result = await send<ImportResult>(IMPORT_PATH, "POST", formData(false));
    setSaved(result); onDone(); setIndex(3);
    toast(`${result.created ?? 0} siswa tersimpan.`);
  });
  return <WizardDialog eyebrow="Data siswa" title="Impor siswa dari Excel" steps={STEPS} index={index} reachable={reachable} lockedBefore={saved ? 3 : 0} onStep={setIndex} onClose={onClose} busy={saving.busy}
    fallback={onFallback && !saved ? { label: "Buka formulir impor lengkap", onClick: onFallback } : undefined}>
    {index === 0 && <TemplateStep onNext={() => setIndex(1)} />}
    {index === 1 && <UploadStep file={file} activate={activate} releaseNisn={releaseNisn} check={check} busy={saving.busy} onFile={pick} onActivate={(v) => { setActivate(v); setCheck(null); }} onRelease={(v) => { setReleaseNisn(v); setCheck(null); }} onCheck={runCheck} onBack={() => setIndex(0)} onNext={() => setIndex(2)} />}
    {index === 2 && check && <SaveStep report={check.report} activate={activate} busy={saving.busy} onSave={runSave} onBack={() => setIndex(1)} />}
    {index === 3 && saved && <PasswordsStep result={saved} activate={activate} onClose={onClose} />}
    <FormError text={saving.error} />
  </WizardDialog>;
}

function TemplateStep({ onNext }: { onNext: () => void }) {
  const { schoolId, toast } = useHub();
  const { demo } = useWizardApi();
  const download = () => {
    if (demo) { toast(DEMO_BLOCKED); return; }
    downloadApiFile(scoped(`${IMPORT_PATH}/template`, schoolId), "template-siswa.xlsx").catch((e: unknown) => toast(e instanceof Error ? e.message : "Unduhan gagal."));
  };
  return <>
    <StepIntro title="Unduh templat Excel" why="Templat berisi kolom yang diterima dan daftar kelas aktif, jadi nama kelas tidak salah ketik." />
    <ul className="wizard-tips">
      <li>Isi satu siswa per baris; jangan ubah judul kolom.</li>
      <li>Kolom bertanda * wajib bila siswa langsung diaktifkan (mis. NISN 10 digit, tanggal lahir, wali).</li>
      <li>Maksimal 1.000 baris dan 2 MB per berkas.</li>
    </ul>
    <StepActions><button type="button" className="button secondary" onClick={download}><Icon name="download" size={16} />Unduh templat</button><button type="button" className="button primary" onClick={onNext}>Berkas sudah siap<Icon name="arrow" size={16} /></button></StepActions>
  </>;
}

interface UploadProps {
  readonly file: File | null; readonly activate: boolean; readonly releaseNisn: boolean; readonly check: ImportResult | null; readonly busy: boolean;
  readonly onFile: (file: File | null) => void; readonly onActivate: (value: boolean) => void; readonly onRelease: (value: boolean) => void;
  readonly onCheck: () => void; readonly onBack: () => void; readonly onNext: () => void;
}

function UploadStep({ file, activate, releaseNisn, check, busy, onFile, onActivate, onRelease, onCheck, onBack, onNext }: UploadProps) {
  const summary = check ? importSummary(check.report) : null;
  const hasWarnings = Boolean(check && check.report.warningRows > 0);
  return <>
    <StepIntro title="Unggah & periksa" why="Pemeriksaan tidak menyimpan apa pun; kamu melihat dulu baris mana yang perlu diperbaiki." />
    <label className="file-picker"><Icon name="upload" size={22} /><span>{file ? file.name : "Pilih berkas .xlsx atau .csv"}<small>{file ? `${Math.ceil(file.size / 1024)} KB` : "Maks. 2 MB"}</small></span><input type="file" accept=".xlsx,.csv" onChange={(e) => onFile(e.target.files?.[0] ?? null)} /></label>
    <label className="check-field"><input type="checkbox" checked={activate} onChange={(e) => onActivate(e.target.checked)} /><span>Langsung aktifkan siswa<small>Siswa aktif bisa langsung masuk dan absen. Tanpa centang, siswa disimpan sebagai draf untuk dilengkapi nanti.</small></span></label>
    {hasWarnings && <label className="check-field"><input type="checkbox" checked={releaseNisn} onChange={(e) => onRelease(e.target.checked)} /><span>Izinkan pelepasan NISN dari siswa yang telah lulus<small>Centang bila peringatan menyebut NISN masih dipakai siswa lulusan sekolah lain.</small></span></label>}
    {summary && <div className={`${summary.tone}-message`} role="status">{summary.text}</div>}
    {check && <ProblemTable report={check.report} />}
    <StepActions back={onBack}>
      <button type="button" className={`button ${summary?.canSave ? "secondary" : "primary"}`} disabled={!file || busy} onClick={onCheck}>{busy ? "Memeriksa…" : check ? "Periksa ulang" : "Periksa berkas"}</button>
      {summary?.canSave && <button type="button" className="button primary" onClick={onNext}>Lanjut simpan<Icon name="arrow" size={16} /></button>}
    </StepActions>
  </>;
}

function ProblemTable({ report }: { report: ImportReport }) {
  const rows = problemRows(report);
  if (rows.length === 0) return null;
  return <div className="table-scroll wizard-table"><table>
    <thead><tr><th scope="col">Baris</th><th scope="col">Nama</th><th scope="col">NISN</th><th scope="col">Masalah</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.row}><td>{row.row}</td><td>{row.name ?? "—"}</td><td>{row.nisn ?? "—"}</td>
      <td>{row.errors.map((text) => <span key={text} className="cell-error">{text}</span>)}{row.warnings.map((text) => <span key={text} className="cell-warning">{text}</span>)}</td></tr>)}</tbody>
  </table></div>;
}

function SaveStep({ report, activate, busy, onSave, onBack }: { report: ImportReport; activate: boolean; busy: boolean; onSave: () => void; onBack: () => void }) {
  return <>
    <StepIntro title="Simpan" why="Semua baris disimpan sekaligus; bila satu gagal (mis. NISN baru saja dipakai), tidak ada yang tersimpan sehingga tidak ada data setengah jadi." />
    <div className="wizard-done-card"><strong>{report.totalRows} siswa</strong><span>akan disimpan sebagai {activate ? "siswa aktif (langsung bisa masuk)" : "draf (belum bisa masuk)"}.</span></div>
    <StepActions back={onBack}><button type="button" className="button primary" disabled={busy} onClick={onSave}>{busy ? "Menyimpan…" : `Simpan ${report.totalRows} siswa`}</button></StepActions>
  </>;
}

function PasswordsStep({ result, activate, onClose }: { result: ImportResult; activate: boolean; onClose: () => void }) {
  const credentials = result.credentials ?? [];
  const download = () => saveTextFile(credentialsCsv(credentials), "kata-sandi-awal-siswa.csv");
  const print = () => window.print();
  return <>
    <StepIntro title="Kata sandi awal" tone="warning" why={credentials.length ? `Siswa masuk dengan NISN dan kata sandi awal ${DEFAULT_STUDENT_PASSWORD}; wajib diganti saat masuk pertama (berlaku 14 hari). Unduh atau cetak daftar bila perlu dibagikan.` : activate ? "Siswa tersimpan." : "Siswa tersimpan sebagai draf; kata sandi dibuat saat siswa diaktifkan."} />
    {credentials.length > 0 && <div className="table-scroll wizard-table credentials-table"><table>
      <thead><tr><th scope="col">Nama</th><th scope="col">NISN (untuk masuk)</th><th scope="col">Kelas</th><th scope="col">Kata sandi sementara</th></tr></thead>
      <tbody>{credentials.map((c) => <tr key={c.row}><td>{c.name}</td><td>{c.nisn}</td><td>{c.className ?? "—"}</td><td><code>{c.temporaryPassword}</code></td></tr>)}</tbody>
    </table></div>}
    <StepActions>
      {credentials.length > 0 && <><button type="button" className="button secondary" onClick={download}><Icon name="download" size={16} />Unduh CSV</button><button type="button" className="button secondary" onClick={print}><Icon name="print" size={16} />Cetak</button></>}
      <button type="button" className="button primary" onClick={onClose}>Selesai</button>
    </StepActions>
  </>;
}
