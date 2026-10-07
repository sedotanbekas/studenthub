"use client";
import { useState } from "react";
import type { Module } from "@/lib/frontend/types";
import { drillDown, INITIAL_FILTER, scopeOptions, type ChildLevel, type SppFilter } from "@/lib/frontend/spp-analytics-rules";
import { Segmented } from "../charts/segmented";
import { useHub } from "../context";
import { Icon } from "../icon";
import { SppBreakdownPanel, SppStatusPanel, SppStudentsPanel, SppSummary, SppTrendPanel } from "./spp-panels";
import { useChoices, useSppAnalytics, type Choice } from "./use-spp";

/**
 * Analitik SPP per lingkup (pemilik 2026-10-07): keseluruhan / provinsi / kabupaten-kota / sekolah. Super admin memilih
 * lingkup apa pun, Admin Pemda di dalam wilayahnya, admin sekolah langsung melihat sekolahnya. Klik rincian = turun
 * satu tingkat (provinsi -> kota -> sekolah -> kelas).
 */
const MONTH_OPTIONS = [{ value: "3", label: "3 bulan" }, { value: "6", label: "6 bulan" }, { value: "12", label: "12 bulan" }] as const;

export function SppAnalyticsPage({ module }: { module: Module }) {
  const { me } = useHub();
  const [filter, setFilter] = useState<SppFilter>(INITIAL_FILTER);
  const [version, setVersion] = useState(0);
  const { data, error, loading, incomplete } = useSppAnalytics(filter, version);
  const canDrill = me.user.role !== "SCHOOL_ADMIN";
  const drill = (child: ChildLevel, key: string) => { const next = drillDown(filter, child, key); if (next) setFilter(next); };
  return <div className="workspace-page brand-analytics spp-analytics">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{data ? `${data.scope.label} · tagihan SPP ${filter.months} bulan terakhir.` : module.description}</p></div></div>
    <SppFilters filter={filter} onChange={setFilter} />
    {error && <div className="error-message" role="alert">{error} <button type="button" className="text-button" onClick={() => setVersion(v => v + 1)}>Coba lagi</button></div>}
    {incomplete ? <div className="panel empty-state"><span className="empty-icon"><Icon name="location" size={30} /></span><h3>Lengkapi pilihan lingkup</h3><p>Pilih wilayah atau sekolah yang ingin dilihat.</p></div>
      : !data ? <div className="panel"><div className="skeleton" /><div className="skeleton" /><div className="skeleton" /></div>
        : <>
          <SppSummary data={data} />
          <div className="brand-columns trend-row"><SppTrendPanel data={data} loading={loading} /><SppStatusPanel data={data} /></div>
          <SppBreakdownPanel data={data} onSelect={canDrill ? drill : null} />
          <SppStudentsPanel data={data} />
        </>}
  </div>;
}

function SppFilters({ filter, onChange }: { filter: SppFilter; onChange: (next: SppFilter) => void }) {
  const { me } = useHub();
  const region = me.region ?? null;
  const options = scopeOptions(me.user.role, region);
  const set = (patch: Partial<SppFilter>) => onChange({ ...filter, ...patch });
  return <div className="spp-filters panel">
    {options.length > 0 && <Segmented options={options} value={filter.scope} onChange={scope => set({ scope, provinceCode: region?.provinceCode ?? (scope === "all" ? "" : filter.provinceCode), cityCode: region?.cityCode ?? "", schoolId: "" })} ariaLabel="Lingkup analitik" />}
    <ScopeSelectors filter={filter} set={set} />
    <Segmented options={MONTH_OPTIONS} value={String(filter.months) as "3" | "6" | "12"} onChange={months => set({ months: Number(months) as 3 | 6 | 12 })} ariaLabel="Rentang bulan tagihan" />
  </div>;
}

function ScopeSelectors({ filter, set }: { filter: SppFilter; set: (patch: Partial<SppFilter>) => void }) {
  const { me } = useHub();
  const role = me.user.role;
  const region = me.region ?? null;
  const province = region?.provinceCode ?? filter.provinceCode;
  const needsProvince = role === "SUPER_ADMIN" && filter.scope !== "all";
  const needsCity = filter.scope === "city" || (filter.scope === "school" && !region?.cityCode);
  const provinces = useChoices("provinces", needsProvince ? "/regions/provinces" : null);
  const cities = useChoices("cities", needsCity && province ? `/regions/provinces/${encodeURIComponent(province)}/cities` : null);
  const schoolFilter = new URLSearchParams({ limit: "100", ...(filter.cityCode ? { cityCode: filter.cityCode } : {}), ...(role === "SUPER_ADMIN" && province ? { provinceCode: province } : {}) });
  const schools = useChoices("schools", filter.scope === "school" ? `${role === "REGION_ADMIN" ? "/region/schools" : "/platform/schools"}?${schoolFilter.toString()}` : null);
  return <>
    {needsProvince && <Select label="Provinsi" value={filter.provinceCode} choices={provinces} onChange={provinceCode => set({ provinceCode, cityCode: "", schoolId: "" })} />}
    {needsCity && <Select label={filter.scope === "school" ? "Kab/kota (saring)" : "Kabupaten/kota"} value={filter.cityCode} choices={cities} onChange={cityCode => set({ cityCode, schoolId: "" })} />}
    {filter.scope === "school" && <Select label="Sekolah" value={filter.schoolId} choices={schools} onChange={schoolId => set({ schoolId })} />}
  </>;
}

function Select({ label, value, choices, onChange }: { label: string; value: string; choices: Choice[]; onChange: (value: string) => void }) {
  return <label className="scope-select spp-select">{label}<select value={value} onChange={e => onChange(e.target.value)}><option value="">Pilih {label.toLowerCase()}</option>{choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></label>;
}
