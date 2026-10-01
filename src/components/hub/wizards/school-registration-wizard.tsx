"use client";
import { useEffect, useState } from "react";
import { EDUCATION_LEVEL_GROUPS, EDUCATION_LEVEL_LABELS, EDUCATION_LEVEL_NAMES, type EducationLevel } from "@/lib/schools/education-level";
import { api } from "@/lib/frontend/api";
import { regionsFromSchools } from "@/lib/frontend/campaign-rules";
import { demoTargetSchools } from "@/lib/frontend/demo-ads";
import { adminProblem, bankProblem, identityProblem, locationProblem, loginHint, provinceCenter, timezoneForProvince } from "@/lib/frontend/wizard-rules";
import type { SchoolTz } from "@/lib/time/zone";
import { FormError, Why } from "../academics/form-kit";
import { useSaving } from "../academics/use-academics";
import { useHub } from "../context";
import { Icon } from "../icon";
import { PasswordInput } from "../password-input";
import { LocationPicker } from "./location-picker";
import { StepActions, StepIntro, useCloseGuard, useWizardApi, WizardDialog, type CustomActionProps } from "./wizard-kit";

/** Wizard super admin: identitas -> lokasi di peta -> rekening SPP -> admin utama -> daftarkan (sekolah lalu akun admin). */
interface Form {
  name: string; npsn: string; educationLevel: EducationLevel | null; address: string; provinceCode: string; cityCode: string; timezone: SchoolTz;
  latitude: number | null; longitude: number | null; radiusM: number; bankName: string; bankAccountNumber: string; bankAccountHolder: string;
  adminName: string; adminEmail: string; adminPassword: string;
}
interface Region { readonly code: string; readonly name: string }
interface Created { readonly schoolName: string; readonly npsn: string | null; readonly email: string | null; readonly temporaryPassword: string | null }

const STEPS = [{ key: "identity", title: "Identitas" }, { key: "location", title: "Lokasi" }, { key: "bank", title: "Rekening SPP" }, { key: "admin", title: "Admin utama" }, { key: "submit", title: "Daftarkan" }];
const DEMO_REGIONS = regionsFromSchools(demoTargetSchools);
const EMPTY: Form ={ name: "", npsn: "", educationLevel: null, address: "", provinceCode: "", cityCode: "", timezone: "WIB", latitude: null, longitude: null, radiusM: 150, bankName: "", bankAccountNumber: "", bankAccountHolder: "", adminName: "", adminEmail: "", adminPassword: "" };

/** Tutup yang menghilangkan sesuatu: admin utama belum dibuat, atau kata sandi sementara belum dicetak. */
function closeWarning(schoolSaved: boolean, created: Created | null, printed: boolean): string | null {
  if (schoolSaved && !created) return "Sekolah sudah tersimpan, tetapi akun admin utama belum dibuat. Bila ditutup, buat admin lewat menu Pengguna.";
  if (created?.temporaryPassword && !printed) return "Kata sandi sementara admin belum dicetak atau dicatat, dan tidak bisa ditampilkan lagi.";
  return null;
}

function problems(form: Form): (string | null)[] {
  return [
    identityProblem(form),
    form.latitude === null || form.longitude === null ? (form.provinceCode && form.cityCode ? "Klik peta untuk menaruh titik sekolah." : "Pilih provinsi dan kabupaten/kota.") : locationProblem({ ...form, latitude: form.latitude, longitude: form.longitude }),
    bankProblem(form),
    adminProblem({ name: form.adminName, email: form.adminEmail, hasNpsn: Boolean(form.npsn.trim()) }),
  ];
}

export function SchoolRegistrationWizard({ onClose, onDone, onFallback }: CustomActionProps) {
  const { toast } = useHub();
  const { send } = useWizardApi();
  const [index, setIndex] = useState(0);
  const [form, setForm] = useState<Form>(EMPTY);
  const [schoolId, setSchoolId] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);
  const [printed, setPrinted] = useState(false);
  const saving = useSaving();
  const guard = useCloseGuard(onClose, closeWarning(Boolean(schoolId), created, printed));
  const issues = problems(form);
  const firstIssue = issues.findIndex((p) => p !== null);
  const reachable = created ? 4 : firstIssue < 0 ? 4 : firstIssue;
  const update = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));
  const register = () => saving.run(async () => {
    let id = schoolId;
    if (!id) {
      const school = await send<{ id: string }>("/platform/schools", "POST", schoolBody(form));
      id = school.id; setSchoolId(id); onDone();
    }
    const admin = await send<{ temporaryPassword?: string }>("/platform/users", "POST", { role: "SCHOOL_ADMIN", name: form.adminName.trim(), email: form.adminEmail.trim() || undefined, schoolId: id, initialPassword: form.adminPassword || undefined });
    setCreated({ schoolName: form.name.trim(), npsn: form.npsn.trim() || null, email: form.adminEmail.trim() || null, temporaryPassword: admin.temporaryPassword ?? null });
    toast(`${form.name.trim()} terdaftar.`);
  });
  const step = (i: number, next: number) => <StepActions back={i > 0 ? () => setIndex(i - 1) : undefined}><button type="button" className="button primary" disabled={issues[i] !== null} onClick={() => setIndex(next)}>Lanjut<Icon name="arrow" size={16} /></button></StepActions>;
  return <WizardDialog eyebrow="Sekolah" title="Daftarkan sekolah baru" steps={STEPS} index={index} reachable={reachable} lockedBefore={schoolId ? 3 : 0} notice={guard.notice} onStep={setIndex} onClose={guard.request} busy={saving.busy}
    fallback={onFallback && !schoolId ? { label: "Buka formulir lengkap", onClick: onFallback } : undefined}>
    {index === 0 && <><IdentityStep form={form} update={update} />{issues[0] && <p className="field-hint">{issues[0]}</p>}{step(0, 1)}</>}
    {index === 1 && <><LocationStep form={form} update={update} />{issues[1] && <p className="field-hint">{issues[1]}</p>}{step(1, 2)}</>}
    {index === 2 && <><BankStep form={form} update={update} />{issues[2] && <p className="field-error">{issues[2]}</p>}{step(2, 3)}</>}
    {index === 3 && <><AdminStep form={form} update={update} />{issues[3] && <p className="field-hint">{issues[3]}</p>}{step(3, 4)}</>}
    {index === 4 && (created ? <DoneStep created={created} onPrinted={() => setPrinted(true)} onClose={guard.request} /> : <SubmitStep form={form} schoolCreated={Boolean(schoolId)} busy={saving.busy} onSubmit={register} onBack={() => setIndex(3)} />)}
    <FormError text={saving.error} />
  </WizardDialog>;
}

function schoolBody(form: Form): Record<string, unknown> {
  const bank = form.bankName.trim() ? { bankName: form.bankName.trim(), bankAccountNumber: form.bankAccountNumber.trim(), bankAccountHolder: form.bankAccountHolder.trim() } : {};
  return {
    name: form.name.trim(), educationLevel: form.educationLevel, npsn: form.npsn.trim() || undefined, address: form.address.trim() || undefined,
    provinceCode: form.provinceCode, cityCode: form.cityCode, timezone: form.timezone, latitude: form.latitude, longitude: form.longitude, geofenceRadiusM: form.radiusM, ...bank,
  };
}

interface StepProps { readonly form: Form; readonly update: (patch: Partial<Form>) => void }

function IdentityStep({ form, update }: StepProps) {
  return <>
    <StepIntro title="Identitas sekolah" why="NPSN dipakai admin utama untuk masuk; jenjang menentukan pilihan tingkat kelas (mis. SMK: tingkat 1–3 = kelas 10–12)." />
    <div className="form-grid">
      <label className="field full-width">Nama sekolah<input value={form.name} maxLength={150} onChange={(e) => update({ name: e.target.value })} placeholder="mis. SMK Bina Nusa Mandiri" /></label>
      <label className="field">NPSN<input value={form.npsn} inputMode="numeric" maxLength={8} onChange={(e) => update({ npsn: e.target.value.replace(/\D/g, "") })} placeholder="8 digit (opsional)" /></label>
      <label className="field">Alamat<input value={form.address} maxLength={500} onChange={(e) => update({ address: e.target.value })} placeholder="Opsional" /></label>
    </div>
    {EDUCATION_LEVEL_GROUPS.map(([title, levels]) => <fieldset key={title} className="level-group"><legend>{title}</legend>
      <div className="level-options">{levels.map((value) => <label key={value} className={`level-card${form.educationLevel === value ? " selected" : ""}`}><input type="radio" name="level" checked={form.educationLevel === value} onChange={() => update({ educationLevel: value })} /><strong>{EDUCATION_LEVEL_LABELS[value]}</strong><small>{EDUCATION_LEVEL_NAMES[value]}</small></label>)}</div>
    </fieldset>)}
  </>;
}

/** Data wilayah dari /regions; mode demo memakai wilayah sekolah contoh (data contoh tidak memuat /regions). */
function useRegionOptions(provinceCode: string): { provinces: readonly Region[]; cities: readonly Region[]; error: string } {
  const { demo } = useWizardApi();
  const [provinces, setProvinces] = useState<readonly Region[]>([]);
  const [cities, setCities] = useState<{ key: string; rows: readonly Region[] }>({ key: "", rows: [] });
  const [error, setError] = useState("");
  useEffect(() => {
    const load = demo ? Promise.resolve(DEMO_REGIONS.provinces) : api("/regions/provinces").then((r) => r.data as Region[]);
    load.then(setProvinces).catch((e: unknown) => setError(e instanceof Error ? e.message : "Daftar provinsi gagal dimuat."));
  }, [demo]);
  useEffect(() => {
    if (!provinceCode) return;
    let active = true;
    const load = demo ? Promise.resolve(DEMO_REGIONS.cities.filter((c) => c.provinceCode === provinceCode))
      : api(`/regions/provinces/${encodeURIComponent(provinceCode)}/cities`).then((r) => r.data as Region[]);
    load.then((rows) => { if (active) setCities({ key: provinceCode, rows }); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : "Daftar kabupaten/kota gagal dimuat."); });
    return () => { active = false; };
  }, [demo, provinceCode]);
  return { provinces, cities: cities.key === provinceCode ? cities.rows : [], error };
}

function LocationStep({ form, update }: StepProps) {
  const { provinces, cities, error } = useRegionOptions(form.provinceCode);
  const point = form.latitude !== null && form.longitude !== null ? { latitude: form.latitude, longitude: form.longitude } : null;
  const useMyLocation = () => navigator.geolocation?.getCurrentPosition((pos) => update({ latitude: Number(pos.coords.latitude.toFixed(7)), longitude: Number(pos.coords.longitude.toFixed(7)) }));
  return <>
    <StepIntro title="Wilayah & lokasi" why="Siswa hanya bisa absen di dalam lingkaran area sekolah; titik yang meleset membuat absen ditolak." />
    <div className="form-grid">
      <label className="field">Provinsi<select value={form.provinceCode} onChange={(e) => update({ provinceCode: e.target.value, cityCode: "", timezone: timezoneForProvince(e.target.value) })}><option value="">Pilih provinsi</option>{provinces.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}</select></label>
      <label className="field">Kabupaten / kota<select value={form.cityCode} disabled={!form.provinceCode} onChange={(e) => update({ cityCode: e.target.value })}><option value="">Pilih kabupaten/kota</option>{cities.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
      <label className="field">Zona waktu<select value={form.timezone} onChange={(e) => update({ timezone: e.target.value as SchoolTz })}>{(["WIB", "WITA", "WIT"] as const).map((tz) => <option key={tz} value={tz}>{tz}</option>)}</select><span className="field-hint">Ditebak dari provinsi; jam absen mengikuti zona ini.</span></label>
      <label className="field">Radius area absen: {form.radiusM} m<input type="range" min={50} max={1000} step={10} value={form.radiusM} onChange={(e) => update({ radiusM: Number(e.target.value) })} /></label>
    </div>
    <FormError text={error} />
    <LocationPicker point={point} radiusM={form.radiusM} focus={provinceCenter(form.provinceCode)} onPick={(p) => update({ latitude: p.latitude, longitude: p.longitude })} />
    <button type="button" className="text-button" onClick={useMyLocation}><Icon name="location" size={15} />Pakai lokasi saya (bila sedang di sekolah)</button>
  </>;
}

function BankStep({ form, update }: StepProps) {
  return <>
    <StepIntro title="Rekening SPP (opsional)" why="Rekening ini ditampilkan ke siswa saat membayar SPP; hanya super admin yang bisa mengubahnya agar tidak dialihkan." />
    <div className="form-grid">
      <label className="field">Nama bank<input value={form.bankName} maxLength={50} onChange={(e) => update({ bankName: e.target.value })} placeholder="mis. BRI" /></label>
      <label className="field">Nomor rekening<input value={form.bankAccountNumber} inputMode="numeric" maxLength={30} onChange={(e) => update({ bankAccountNumber: e.target.value.replace(/\D/g, "") })} /></label>
      <label className="field full-width">Atas nama<input value={form.bankAccountHolder} maxLength={100} onChange={(e) => update({ bankAccountHolder: e.target.value })} /></label>
    </div>
    <Why>Boleh dilewati dan diisi nanti dari menu Sekolah.</Why>
  </>;
}

function AdminStep({ form, update }: StepProps) {
  const hasNpsn = Boolean(form.npsn.trim());
  return <>
    <StepIntro title="Admin utama" why={hasNpsn ? `Admin utama masuk dengan NPSN ${form.npsn.trim()}; email opsional sebagai cadangan.` : "Sekolah tanpa NPSN: admin utama masuk dengan email."} />
    <div className="form-grid">
      <label className="field">Nama admin<input value={form.adminName} maxLength={100} onChange={(e) => update({ adminName: e.target.value })} /></label>
      <label className="field">Email{hasNpsn ? " (opsional)" : ""}<input type="email" value={form.adminEmail} onChange={(e) => update({ adminEmail: e.target.value })} /></label>
      <label className="field full-width">Kata sandi awal (opsional)<PasswordInput value={form.adminPassword} autoComplete="new-password" onChange={(e) => update({ adminPassword: e.target.value })} /><span className="field-hint">Kosongkan agar dibuatkan otomatis. Admin wajib menggantinya saat masuk pertama.</span></label>
    </div>
  </>;
}

function SubmitStep({ form, schoolCreated, busy, onSubmit, onBack }: { form: Form; schoolCreated: boolean; busy: boolean; onSubmit: () => void; onBack: () => void }) {
  return <>
    <StepIntro title="Periksa & daftarkan" why={schoolCreated ? "Sekolah sudah tersimpan; tinggal membuat akun admin utama." : "Sekolah dibuat dengan jadwal absen bawaan; admin sekolah menyesuaikannya lewat panduan di aplikasi."} tone={schoolCreated ? "warning" : "info"} />
    <dl className="wizard-summary">
      <dt>Sekolah</dt><dd>{form.name} · {form.educationLevel ? EDUCATION_LEVEL_LABELS[form.educationLevel] : "—"}{form.npsn ? ` · NPSN ${form.npsn}` : ""}</dd>
      <dt>Lokasi</dt><dd>{form.latitude}, {form.longitude} · radius {form.radiusM} m · {form.timezone}</dd>
      <dt>Rekening</dt><dd>{form.bankName ? `${form.bankName} ${form.bankAccountNumber} a.n. ${form.bankAccountHolder}` : "Belum diisi"}</dd>
      <dt>Admin utama</dt><dd>{form.adminName}{form.adminEmail ? ` · ${form.adminEmail}` : ""}</dd>
    </dl>
    <StepActions back={onBack}><button type="button" className="button primary" disabled={busy} onClick={onSubmit}>{busy ? "Mendaftarkan…" : schoolCreated ? "Buat akun admin" : "Daftarkan sekolah"}</button></StepActions>
  </>;
}

function DoneStep({ created, onPrinted, onClose }: { created: Created; onPrinted: () => void; onClose: () => void }) {
  return <>
    <StepIntro title={`${created.schoolName} terdaftar`} tone="success" why="Berikan data masuk berikut ke admin sekolah. Saat masuk pertama, panduan Akademik membantunya menyiapkan semester dan kelas." />
    <div className="wizard-done-card credentials-table"><strong>{loginHint(created)}</strong>{created.temporaryPassword ? <span>Kata sandi sementara: <code>{created.temporaryPassword}</code> (hanya tampil sekali)</span> : <span>Memakai kata sandi awal yang kamu isi.</span>}</div>
    <StepActions><button type="button" className="button secondary" onClick={() => { window.print(); onPrinted(); }}><Icon name="print" size={16} />Cetak</button><button type="button" className="button primary" onClick={onClose}>Selesai</button></StepActions>
  </>;
}
