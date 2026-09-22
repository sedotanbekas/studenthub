"use client";
import { useEffect, useState } from "react";
import { api, scoped } from "@/lib/frontend/api";
import { rawSchema, resolveSchema } from "@/lib/frontend/catalog";
import { display, label } from "@/lib/frontend/format";
import { demoRows } from "@/lib/frontend/demo";
import type { Row, Schema } from "@/lib/frontend/types";
import { useHub } from "./context";
import { Icon } from "./icon";

export function defaults(input: Schema, initial: Row = {}): Row {
  const schema = resolveSchema(input, initial);
  return Object.fromEntries(Object.entries(schema.properties ?? {}).flatMap(([key, value]) => {
    const field = resolveSchema(value);
    const current = initial[key] ?? field.const ?? field.default ?? (schema.required?.includes(key) && field.type === "object" ? defaults(field) : undefined);
    return current === undefined || current === null ? [] : [[key, current]];
  }));
}
export function Fields({ schema: input, value, onChange }: { schema: Schema; value: Row; onChange: (value: Row) => void }) {
  const schema = resolveSchema(input, value);
  return <div className="form-grid">{Object.entries(schema.properties ?? {}).map(([key, field]) => <Field key={key} name={key} schema={key === "cityCode" && value.provinceCode ? { ...field, lookup: `/regions/provinces/${encodeURIComponent(String(value.provinceCode))}/cities` } : field} value={value[key]} required={schema.required?.includes(key)} onChange={next => onChange({ ...value, ...(key === "provinceCode" ? { cityCode: undefined } : {}), [key]: next })} />)}</div>;
}
const lookupPaths: Record<string, string> = { currentClassId: "/school/classes", classId: "/school/classes", classIds: "/school/classes", studentId: "/school/students", studentIds: "/school/students", schoolId: "/platform/schools", schoolIds: "/platform/schools", subjectId: "/school/subjects", subjectIds: "/school/subjects", academicYearId: "/school/academic-years", termId: "/school/academic-years", sponsorId: "/platform/sponsors", invoiceId: "/school/invoices", provinceCode: "/regions/provinces" };
interface FieldProps { name: string; schema: Schema; value: unknown; required?: boolean; onChange: (value: unknown) => void }
export function Field({ name, schema: input, value, required, onChange }: FieldProps) {
  const raw = rawSchema(input);
  const variants = (raw.oneOf ?? raw.anyOf)?.filter(s => s.type !== "null");
  if (variants && variants.length > 1 && variants.every(v => v.type === "object")) return <VariantField {...{ name, schema: raw, value, required, onChange }} />;
  return <SimpleField {...{ name, schema: input, value, required, onChange }} />;
}
function SimpleField({ name, schema: input, value, required, onChange }: FieldProps) {
  const schema = resolveSchema(input);
  const original = rawSchema(input);
  const nullable = Array.isArray(original.type) && original.type.includes("null") || (original.anyOf ?? original.oneOf)?.some(s => s.type === "null");
  const type = Array.isArray(schema.type) ? schema.type.find(t => t !== "null") : schema.type;
  const caption = <span>{label(name)}{required && <b className="required"> *</b>}</span>;
  if (name === "schoolDaysMask") return <WeekdayField value={value} onChange={onChange} />;
  if (/^(dayStartMinute|dayEndMinute|checkInOpenMinute)$/.test(name)) return <label className="field">{caption}<input type="time" required={required} value={typeof value === "number" ? `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}` : ""} onChange={e => { const [hours, minutes] = e.target.value.split(":").map(Number); onChange(hours === undefined || minutes === undefined ? undefined : hours * 60 + minutes); }} /></label>;
  if (name === "imageFileId") return <BannerField value={value} required={required} onChange={onChange} />;
  if (type === "object") return <fieldset className="nested-field"><legend>{label(name)}</legend><Fields schema={schema} value={(value ?? {}) as Row} onChange={onChange} /></fieldset>;
  if (type === "array") return <ArrayField {...{ name, schema, value, required, onChange }} />;
  if (schema.const !== undefined) return null;
  if (type === "boolean") return <label className="check-field"><input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} /><span>{caption}{schema.description && <small>{schema.description}</small>}</span></label>;
  const props = { required, value: value === undefined || value === null ? "" : String(value), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(e.target.value === "" ? nullable ? null : undefined : type === "number" || type === "integer" ? Number(e.target.value) : e.target.value) };
  if ((lookupPaths[name] || schema.lookup) && !schema.enum) return <label className="field">{caption}<Lookup name={name} pathOverride={schema.lookup} value={String(value ?? "")} required={required} onChange={onChange} /></label>;
  if (schema.enum) return <label className="field">{caption}<select {...props}><option value="">Pilih {label(name).toLowerCase()}</option>{schema.enum.map(v => <option key={v} value={v}>{label(String(v))}</option>)}</select></label>;
  if (schema.format === "binary") return <label className="field full-width">{caption}<span className="file-picker"><Icon name="upload" size={23} /><span>Pilih berkas dari perangkat<small>{schema.description}</small></span><input type="file" required={required} accept={name === "selfie" || name === "attachment" || name === "proof" ? "image/jpeg,image/png,image/webp" : undefined} capture={name === "selfie" ? "user" : undefined} onChange={e => onChange(e.target.files?.[0])} /></span></label>;
  if (/body|content|description|reason|note|address/i.test(name)) return <label className="field full-width">{caption}<textarea {...props} rows={3} minLength={schema.minLength} maxLength={schema.maxLength} placeholder={`Tulis ${label(name).toLowerCase()}…`} /></label>;
  const inputType = /password/i.test(name) ? "password" : schema.format === "date" || /Date$/.test(name) ? "date" : schema.format === "date-time" ? "datetime-local" : type === "number" || type === "integer" ? "number" : name === "month" ? "month" : /email/i.test(name) ? "email" : "text";
  if (schema.format === "date-time" && props.value) { const date = new Date(props.value); if (!Number.isNaN(date.getTime())) props.value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  return <label className="field">{caption}<input {...props} type={inputType} step={type === "integer" ? 1 : type === "number" ? "any" : undefined} min={schema.minimum} max={schema.maximum} minLength={schema.minLength} maxLength={schema.maxLength} placeholder={typeof schema.example === "string" ? schema.example : label(name)} />{schema.description && <small className="field-hint">{schema.description}</small>}</label>;
}
function VariantField({ name, schema, value, onChange }: FieldProps) {
  const variants = (schema.oneOf ?? schema.anyOf ?? []).filter(s => s.type !== "null");
  const row = value && typeof value === "object" ? value as Row : {};
  const selected = variants.findIndex(s => Object.entries(s.properties ?? {}).some(([key, field]) => field.const !== undefined && field.const === row[key]));
  const index = selected < 0 ? 0 : selected;
  return <fieldset className="nested-field"><legend>{label(name)}</legend><select aria-label={label(name)} value={index} onChange={e => { const variant = variants[Number(e.target.value)]!; onChange(Object.fromEntries(Object.entries(variant.properties ?? {}).filter(([, field]) => field.const !== undefined).map(([key, field]) => [key, field.const]))); }}>{variants.map((variant, i) => <option key={i} value={i}>{label(String(Object.values(variant.properties ?? {}).find(f => f.const !== undefined)?.const ?? `Pilihan ${i + 1}`))}</option>)}</select><Fields schema={variants[index]!} value={row} onChange={onChange} /></fieldset>;
}
function ArrayField({ name, schema, value, onChange }: FieldProps) {
  const values = Array.isArray(value) ? value : [];
  const item = resolveSchema(schema.items);
  return <fieldset className="nested-field"><legend>{label(name)}</legend>{values.map((entry, i) => <div className="array-entry" key={i}><div>{item.type === "object" ? <Fields schema={item} value={entry as Row} onChange={next => onChange(values.map((v, n) => n === i ? next : v))} /> : <Field name={name} schema={item} value={entry} required onChange={next => onChange(values.map((v, n) => n === i ? next : v))} />}</div><button type="button" className="icon-button" aria-label={`Hapus ${label(name)} ${i + 1}`} onClick={() => onChange(values.filter((_, n) => n !== i))}><Icon name="close" size={17} /></button></div>)}<button type="button" className="button secondary small-button" onClick={() => onChange([...values, item.type === "object" ? defaults(item) : ""])}><Icon name="plus" size={15} />Tambah {label(name).toLowerCase()}</button></fieldset>;
}
function Lookup({ name, value, required, onChange, pathOverride }: { name: string; value: string; required?: boolean; onChange: (value: string | undefined) => void; pathOverride?: string }) {
  const { schoolId, demo, me } = useHub();
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const isTerm = name === "termId" || pathOverride?.endsWith("#terms");
  let path = (pathOverride ?? lookupPaths[name]!).replace("#terms", "");
  if (me.user.role === "SPONSOR" && ["schoolId", "schoolIds"].includes(name)) path = "/sponsor/targeting/schools";
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (demo) { let options = (demoRows(path) as Row[]) ?? []; if (isTerm) options = options.flatMap(y => y.terms as Row[] ?? []); setRows(options); return; }
      const searchable = /students|sponsors|schools|invoices/.test(path);
      const queryString = searchable ? `?limit=100${query ? `&q=${encodeURIComponent(query)}` : ""}` : "";
      api(scoped(`${path}${queryString}`, schoolId)).then(r => {
        if (!active) return;
        let options = Array.isArray(r.data) ? r.data as Row[] : [];
        if (isTerm) options = options.flatMap(y => (y.terms as Row[] ?? []).map(t => ({ ...t, name: `${display(y.name ?? y.label)} · ${display(t.label ?? t.name ?? t.semester)}` })));
        setRows(options); setError("");
      }).catch(e => { if (active) setError(e.message); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [path, schoolId, demo, isTerm, query]);
  return <span className="lookup">{/students|sponsors|schools|invoices/.test(path) && <input aria-label={`Cari ${label(name)}`} placeholder={`Cari ${label(name).toLowerCase()}…`} value={query} onChange={e => setQuery(e.target.value)} />}<select required={required} value={value} onChange={e => onChange(e.target.value || undefined)}><option value="">Pilih {label(name).toLowerCase()}</option>{value && !rows.some(r => String(r.id ?? r.code) === value) && <option value={value}>Pilihan tersimpan ({value})</option>}{rows.map(r => <option key={String(r.id ?? r.code)} value={String(r.id ?? r.code)}>{display(r.name ?? r.label ?? r.companyName ?? r.invoiceNo)}{r.nis ? ` · ${r.nis}` : ""}</option>)}</select>{error && <small className="field-error">{error}</small>}</span>;
}
function WeekdayField({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  return <fieldset className="nested-field"><legend>Hari sekolah</legend><div className="weekday-picker">{["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"].map((day, i) => <label key={day}><input type="checkbox" checked={(Number(value ?? 0) & (1 << i)) !== 0} onChange={e => onChange(e.target.checked ? Number(value ?? 0) | (1 << i) : Number(value ?? 0) & ~(1 << i))} />{day}</label>)}</div></fieldset>;
}
function BannerField({ value, required, onChange }: { value: unknown; required?: boolean; onChange: (value: unknown) => void }) {
  const { demo } = useHub();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    if (demo) { setError("Unggah banner tersedia setelah masuk dengan akun sponsor."); return; }
    setBusy(true); setError("");
    try { const form = new FormData(); form.set("file", file); const response = await api("/sponsor/banners", { method: "POST", body: form }); const result = response.data as Row; onChange(result.id ?? result.fileId); }
    catch (e) { setError(e instanceof Error ? e.message : "Unggahan gagal."); }
    finally { setBusy(false); }
  }
  return <label className="field full-width"><span>Banner iklan{required && " *"}</span><input type="file" accept="image/jpeg,image/png,image/webp" required={required && !value} disabled={busy} onChange={e => upload(e.target.files?.[0])} /><small className="field-hint">Rasio 2:1, lebar minimal 800 piksel, maksimal 5 MB.</small>{value ? <span className="success-text">Banner siap digunakan.</span> : busy ? <span>Mengunggah banner…</span> : null}{error && <span className="field-error">{error}</span>}</label>;
}
