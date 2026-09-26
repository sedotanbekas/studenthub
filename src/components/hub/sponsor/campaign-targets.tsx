"use client";
import { useEffect, useState } from "react";
import { MAX_TARGETS_PER_AD } from "@/lib/ads/constants";
import type { AdDto, TargetSchool } from "@/lib/frontend/ad-types";
import { api } from "@/lib/frontend/api";
import { regionsFromSchools, type CampaignDraft, type TargetChip } from "@/lib/frontend/campaign-rules";
import { demoTargetSchools } from "@/lib/frontend/demo-ads";
import { useHub } from "../context";
import { Icon } from "../icon";
import { failureOf } from "./campaign-data";
import { FieldError } from "./campaign-fields";

/**
 * Jangkauan kampanye: semua sekolah / provinsi / kab-kota / sekolah tertentu (multi-pilih dengan chip).
 * Data wilayah dari /regions, sekolah dari /sponsor/targeting/schools; mode demo memakai sekolah contoh.
 */
type Scope = AdDto["targetScope"];
interface Region { readonly code: string; readonly name: string; readonly provinceCode?: string }

const SCOPES: readonly { value: Scope; label: string; hint: string }[] = [
  { value: "ALL", label: "Semua sekolah", hint: "Tayang di semua sekolah mitra." },
  { value: "PROVINCE", label: "Provinsi", hint: "Satu atau beberapa provinsi." },
  { value: "CITY", label: "Kabupaten/kota", hint: "Lebih terarah per wilayah." },
  { value: "SCHOOL", label: "Sekolah tertentu", hint: "Hanya sekolah yang dipilih." },
];
const DEMO_REGIONS = regionsFromSchools(demoTargetSchools);

function useRegions(kind: "provinces" | "cities", provinceCode = ""): { rows: readonly Region[]; error: string } {
  const { demo } = useHub();
  const [state, setState] = useState<{ key: string; rows: readonly Region[]; error: string }>({ key: "", rows: [], error: "" });
  const key = `${kind}:${provinceCode}`;
  useEffect(() => {
    if (kind === "cities" && !provinceCode) return;
    let active = true;
    const load = demo
      ? Promise.resolve(kind === "provinces" ? DEMO_REGIONS.provinces : DEMO_REGIONS.cities.filter(c => c.provinceCode === provinceCode))
      : api(kind === "provinces" ? "/regions/provinces" : `/regions/provinces/${encodeURIComponent(provinceCode)}/cities`).then(r => r.data as Region[]);
    load.then(rows => { if (active) setState({ key, rows, error: "" }); }).catch(e => { if (active) setState({ key, rows: [], error: failureOf(e).message }); });
    return () => { active = false; };
  }, [demo, kind, provinceCode, key]);
  return state.key === key ? state : { rows: [], error: "" };
}

function useSchoolSearch(query: string): { rows: readonly TargetSchool[]; loading: boolean; error: string } {
  const { demo } = useHub();
  const [state, setState] = useState<{ query: string | null; rows: readonly TargetSchool[]; error: string }>({ query: null, rows: [], error: "" });
  useEffect(() => {
    let active = true;
    const q = query.trim();
    const timer = setTimeout(() => {
      const load = demo
        ? Promise.resolve(demoTargetSchools.filter(s => s.name.toLowerCase().includes(q.toLowerCase())))
        : api(`/sponsor/targeting/schools?limit=20${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(r => r.data as TargetSchool[]);
      load.then(rows => { if (active) setState({ query, rows, error: "" }); }).catch(e => { if (active) setState({ query, rows: [], error: failureOf(e).message }); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [demo, query]);
  return { rows: state.rows, loading: state.query !== query, error: state.error };
}

interface TargetProps {
  readonly scope: Scope;
  readonly targets: readonly TargetChip[];
  readonly error?: string;
  readonly onChange: (patch: Partial<CampaignDraft>) => void;
}

export function TargetPicker({ scope, targets, error, onChange }: TargetProps) {
  const full = targets.length >= MAX_TARGETS_PER_AD;
  const add = (chip: TargetChip) => { if (!full && !targets.some(t => t.code === chip.code)) onChange({ targets: [...targets, chip] }); };
  const remove = (code: string) => onChange({ targets: targets.filter(t => t.code !== code) });
  const taken = new Set(targets.map(t => t.code));
  return <div className="field">
    <fieldset className="scope-options" id="campaign-targets" tabIndex={-1} aria-describedby={error ? "campaign-targets-error" : undefined}>
      <legend className="sr-only">Jangkauan kampanye</legend>
      {SCOPES.map(s => <label key={s.value} className={`scope-option${scope === s.value ? " on" : ""}`}>
        <input type="radio" name="campaign-scope" value={s.value} checked={scope === s.value} onChange={() => onChange({ scope: s.value, targets: [] })} />
        <span><strong>{s.label}</strong><small>{s.hint}</small></span>
      </label>)}
    </fieldset>
    {scope === "PROVINCE" && <RegionSelect kind="provinces" placeholder="Tambah provinsi…" taken={taken} disabled={full} onAdd={add} />}
    {scope === "CITY" && <CityPicker taken={taken} disabled={full} onAdd={add} />}
    {scope === "SCHOOL" && <SchoolPicker taken={taken} disabled={full} onAdd={add} />}
    {scope !== "ALL" && <ChipList targets={targets} onRemove={remove} />}
    <FieldError id="campaign-targets" error={error} />
  </div>;
}

interface AddProps { readonly taken: ReadonlySet<string>; readonly disabled: boolean; readonly onAdd: (chip: TargetChip) => void }

function RegionSelect({ kind, provinceCode, placeholder, taken, disabled, onAdd }: AddProps & { kind: "provinces" | "cities"; provinceCode?: string; placeholder: string }) {
  const { rows, error } = useRegions(kind, provinceCode);
  const options = rows.filter(r => !taken.has(r.code));
  return <label className="field sub-field">
    <span className="sr-only">{placeholder}</span>
    <select value="" disabled={disabled || (kind === "cities" && !provinceCode)} onChange={e => { const row = rows.find(r => r.code === e.target.value); if (row) onAdd({ code: row.code, label: row.name }); }}>
      <option value="">{kind === "cities" && !provinceCode ? "Pilih provinsi dulu" : placeholder}</option>
      {options.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
    </select>
    {error && <small className="field-error">{error}</small>}
  </label>;
}

function CityPicker(props: AddProps) {
  const [province, setProvince] = useState("");
  const { rows } = useRegions("provinces");
  return <div className="sub-grid">
    <label className="field sub-field"><span className="sr-only">Provinsi</span>
      <select value={province} onChange={e => setProvince(e.target.value)}><option value="">Pilih provinsi…</option>{rows.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}</select>
    </label>
    <RegionSelect kind="cities" provinceCode={province} placeholder="Tambah kabupaten/kota…" {...props} />
  </div>;
}

function SchoolPicker({ taken, disabled, onAdd }: AddProps) {
  const [query, setQuery] = useState("");
  const { rows, loading, error } = useSchoolSearch(query);
  const options = rows.filter(s => !taken.has(s.id));
  return <div className="school-search">
    <label className="field sub-field"><span className="sr-only">Cari sekolah</span>
      <input type="search" value={query} placeholder="Cari nama sekolah…" autoComplete="off" onChange={e => setQuery(e.target.value)} />
    </label>
    {error && <small className="field-error">{error}</small>}
    <ul className="school-results" aria-busy={loading} aria-label="Hasil pencarian sekolah">
      {options.map(s => <li key={s.id}><button type="button" disabled={disabled} onClick={() => onAdd({ code: s.id, label: s.name })}>
        <span><strong>{s.name}</strong><small>{s.cityName}, {s.provinceName}</small></span><Icon name="plus" size={18} />
      </button></li>)}
      {!loading && options.length === 0 && <li className="muted school-empty">{query ? "Sekolah tidak ditemukan." : "Tidak ada sekolah lain untuk dipilih."}</li>}
    </ul>
  </div>;
}

function ChipList({ targets, onRemove }: { targets: readonly TargetChip[]; onRemove: (code: string) => void }) {
  if (targets.length === 0) return <p className="field-hint">Belum ada yang dipilih.</p>;
  return <div className="chip-block">
    <ul className="target-chips" aria-label="Target terpilih">{targets.map(t => <li key={t.code} className="target-chip">{t.label}
      <button type="button" aria-label={`Hapus ${t.label}`} onClick={() => onRemove(t.code)}><Icon name="close" size={14} /></button>
    </li>)}</ul>
    <small className="field-hint">{targets.length} dipilih · maksimal {MAX_TARGETS_PER_AD}</small>
  </div>;
}
