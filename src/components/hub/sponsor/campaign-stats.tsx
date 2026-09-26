"use client";
import { useEffect, useState } from "react";
import type { AdDto, AnalyticsSeries, AnalyticsSummary } from "@/lib/frontend/ad-types";
import { api } from "@/lib/frontend/api";
import { dayLabel, shortDate } from "@/lib/frontend/chart-rules";
import { integerAxisMax } from "@/lib/frontend/campaign-rules";
import { demoAnalyticsSeries, demoAnalyticsSummary } from "@/lib/frontend/demo-ads";
import { number, rupiah } from "@/lib/frontend/format";
import { Segmented } from "../charts/segmented";
import { StatTile } from "../charts/stat-tile";
import { TrendChart } from "../charts/trend-chart";
import { useHub } from "../context";
import { failureOf } from "./campaign-data";

/**
 * Ringkasan 7 hari satu kampanye: 4 angka utama (vs 7 hari sebelumnya, dengan sparkline) dan grafik
 * batang harian satu metrik (dipilih lewat segmen — tidak pernah dua sumbu-y).
 */
type Metric = "clicks" | "impressions" | "spend";
const METRICS: readonly { value: Metric; label: string }[] = [{ value: "clicks", label: "Klik" }, { value: "impressions", label: "Tayangan" }, { value: "spend", label: "Biaya" }];
type WeekState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; summary: AnalyticsSummary; series: AnalyticsSeries };

function useWeek(adId: string): WeekState {
  const { demo } = useHub();
  const [state, setState] = useState<WeekState>({ kind: "loading" });
  useEffect(() => {
    let active = true;
    const query = `preset=7d&adId=${encodeURIComponent(adId)}`;
    const load = demo
      ? Promise.resolve({ summary: demoAnalyticsSummary("7d", undefined, adId), series: demoAnalyticsSeries("7d", undefined, adId) })
      : Promise.all([api(`/sponsor/analytics/summary?${query}`), api(`/sponsor/analytics/timeseries?${query}`)]).then(([s, t]) => ({ summary: s.data as AnalyticsSummary, series: t.data as AnalyticsSeries }));
    load.then(data => { if (active) setState({ kind: "ready", ...data }); })
      .catch(e => { if (active) setState({ kind: "error", message: failureOf(e).message }); });
    return () => { active = false; };
  }, [adId, demo]);
  return state;
}

export function CampaignWeek({ ad }: { ad: AdDto }) {
  return <section className="campaign-week" aria-labelledby={`week-${ad.id}`}>
    <h3 id={`week-${ad.id}`}>7 hari terakhir</h3>
    {ad.status === "DRAFT" ? <p className="muted">Statistik muncul setelah kampanye disetujui dan mulai tayang.</p> : <WeekStats adId={ad.id} />}
  </section>;
}

const percent = (value: number | null) => (value === null ? "—" : `${value.toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`);

function WeekStats({ adId }: { adId: string }) {
  const state = useWeek(adId);
  const [metric, setMetric] = useState<Metric>("clicks");
  if (state.kind === "loading") return <div aria-busy="true"><div className="skeleton" /><div className="skeleton" /></div>;
  if (state.kind === "error") return <p className="error-message" role="alert">{state.message}</p>;
  const { kpis } = state.summary;
  const days = state.series.days;
  const compare = "vs 7 hari sebelumnya";
  const format = metric === "spend" ? rupiah : number;
  const values = days.map(d => d[metric]);
  const chosen = METRICS.find(m => m.value === metric)?.label ?? "";
  return <>
    <div className="week-tiles">
      <StatTile label="Tayangan" value={number(kpis.impressions.value)} change={kpis.impressions.changePct} compareLabel={compare} spark={days.map(d => d.impressions)} />
      <StatTile label="Klik" value={number(kpis.clicks.value)} change={kpis.clicks.changePct} compareLabel={compare} spark={days.map(d => d.clicks)} />
      <StatTile label="Rasio klik" value={percent(kpis.ctr.value)} change={kpis.ctr.changePct} compareLabel={compare} />
      <StatTile label="Biaya" value={rupiah(kpis.spend.value)} change={kpis.spend.changePct} neutral compareLabel={compare} note={`${number(kpis.chargedClicks.value)} klik ditagih`} />
    </div>
    <div className="week-chart">
      <div className="week-chart-head"><strong>{chosen} per hari</strong><Segmented options={METRICS} value={metric} onChange={setMetric} ariaLabel="Metrik grafik harian" /></div>
      <TrendChart labels={days.map(d => d.date)} series={[{ key: metric, label: chosen, color: "var(--primary)", values }]} yCap={integerAxisMax(Math.max(0, ...values))}
        mode="stacked" height={180} format={format} labelFormat={shortDate} titleFormat={dayLabel} ariaLabel={`${chosen} per hari, 7 hari terakhir`} />
    </div>
  </>;
}
