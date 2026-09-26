"use client";
import { useState } from "react";
import type { AdDto, AdPerformanceDto, AnalyticsBreakdown, AnalyticsPeriod, AnalyticsPreset, AnalyticsSeries, AnalyticsSummary } from "@/lib/frontend/ad-types";
import { bannerSrc } from "@/lib/frontend/ad-media";
import type { Module } from "@/lib/frontend/types";
import { adOptionLabel, compareLabel, insightsPath, PERIOD_OPTIONS, periodLabel, rangeLabel, type PerformanceSort } from "@/lib/frontend/sponsor-insights-rules";
import { Segmented } from "../charts/segmented";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";
import { scrollPageToTop } from "../scroll-memory";
import { BreakdownPanel } from "./insights-breakdown";
import { firstError, LoadError, useSponsorData } from "./insights-data";
import { KpiGrid, type KpiKey } from "./insights-kpis";
import { PerformanceTable } from "./insights-table";
import { TrendPanel } from "./insights-trend";

/**
 * Analitik sponsor: filter periode (7/30 hari) + kampanye, 6 KPI vs periode sebelumnya, tren harian
 * satu metrik, sebaran klik per perangkat & provinsi, dan tabel performa per iklan (pilih baris ->
 * filter kampanye). Data lama dipertahankan selama memuat ulang; periode tanpa data -> keadaan kosong.
 */
const ALL_KPIS: readonly KpiKey[] = ["impressions", "clicks", "uniqueClicks", "ctr", "chargedClicks", "spend"];

interface Filter { readonly preset: AnalyticsPreset; readonly adId: string; readonly sort: PerformanceSort }

function useAnalyticsData({ preset, adId, sort }: Filter, version: number) {
  const params = { preset, adId };
  return {
    ads: useSponsorData<AdDto[]>("/sponsor/ads?limit=100", version),
    summary: useSponsorData<AnalyticsSummary>(insightsPath("/sponsor/analytics/summary", params), version),
    series: useSponsorData<AnalyticsSeries>(insightsPath("/sponsor/analytics/timeseries", params), version),
    device: useSponsorData<AnalyticsBreakdown>(insightsPath("/sponsor/analytics/breakdown", { dimension: "device", ...params }), version),
    province: useSponsorData<AnalyticsBreakdown>(insightsPath("/sponsor/analytics/breakdown", { dimension: "province", ...params }), version),
    table: useSponsorData<AdPerformanceDto[]>(insightsPath("/sponsor/analytics/ads", { preset, sort, limit: "50" }), version),
  };
}

export function SponsorAnalyticsPage({ module }: { module: Module }) {
  const [filter, setFilter] = useState<Filter>({ preset: "7d", adId: "", sort: "clicks" });
  const [version, setVersion] = useState(0);
  const { ads, summary, series, device, province, table } = useAnalyticsData(filter, version);
  const update = (patch: Partial<Filter>) => setFilter(f => ({ ...f, ...patch }));
  const kpis = summary.data?.kpis;
  const empty = !!kpis && kpis.impressions.value === 0 && kpis.clicks.value === 0;
  const thumbs = new Map((ads.data ?? []).map(ad => [ad.id, bannerSrc(ad)]));
  return <div className="workspace-page sponsor-analytics">
    <div className="page-heading"><div><h1>{module.title}</h1><p>{module.description}</p></div></div>
    <InsightsFilters filter={filter} onChange={update} ads={ads.data ?? []} period={summary.data?.period ?? null} />
    <LoadError message={firstError(summary, series, device, province, table)} onRetry={() => setVersion(v => v + 1)} />
    <KpiGrid keys={ALL_KPIS} summary={summary.data} days={series.data?.days ?? null} compareLabel="vs periode sebelumnya" loading={summary.loading} />
    <p className="insight-footnote">CTR = klik ÷ tayangan. Klik unik = jumlah siswa berbeda yang mengeklik. Klik ditagih = klik sah yang memotong saldo (paling banyak satu per siswa per iklan per hari).</p>
    {empty ? <EmptyPeriod /> : <>
      <TrendPanel title={`Tren ${periodLabel(filter.preset)}`} note={series.data ? rangeLabel(series.data.period) : undefined} days={series.data?.days ?? null} loading={series.loading} />
      <div className="sponsor-columns even">
        <BreakdownPanel title="Perangkat" note="Jenis perangkat siswa saat mengeklik." data={device.data} loading={device.loading} />
        <BreakdownPanel title="Provinsi" note="Provinsi sekolah siswa yang mengeklik." data={province.data} loading={province.loading} />
      </div>
    </>}
    <PerformanceTable rows={table.data} thumbs={thumbs} loading={table.loading} sort={filter.sort} onSort={sort => update({ sort })} selected={filter.adId} onSelect={adId => { update({ adId }); scrollPageToTop(); }} />
  </div>;
}

function InsightsFilters({ filter, onChange, ads, period }: { filter: Filter; onChange: (patch: Partial<Filter>) => void; ads: readonly AdDto[]; period: AnalyticsPeriod | null }) {
  return <div className="insight-filters" role="group" aria-label="Filter analitik">
    <Segmented options={PERIOD_OPTIONS} value={filter.preset} onChange={preset => onChange({ preset })} ariaLabel="Periode" />
    <label className="insight-select">
      <span className="sr-only">Kampanye</span>
      <select value={filter.adId} onChange={event => onChange({ adId: event.target.value })}>
        <option value="">Semua kampanye</option>
        {ads.map(ad => <option key={ad.id} value={ad.id}>{adOptionLabel(ad)}</option>)}
      </select>
    </label>
    {period && <span className="insight-range"><Icon name="calendar" size={16} />{rangeLabel(period)} · {compareLabel(filter.preset)}</span>}
  </div>;
}

function EmptyPeriod() {
  return <section className="panel empty-state insight-empty">
    <span className="empty-icon"><Icon name="chart" size={30} /></span>
    <h2>Belum ada data pada periode ini</h2>
    <p>Angka muncul setelah iklan tayang di beranda siswa. Pilih periode atau kampanye lain, atau periksa status kampanye Anda.</p>
    <HubLink href="/hub/campaigns" className="button secondary small-button">Lihat kampanye<Icon name="arrow" size={16} /></HubLink>
  </section>;
}
