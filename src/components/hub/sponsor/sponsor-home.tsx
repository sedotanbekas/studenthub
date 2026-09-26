"use client";
import { useState } from "react";
import type { AdDto, AdPerformanceDto, AnalyticsSeries, AnalyticsSummary, SponsorBalanceDto, SponsorDto } from "@/lib/frontend/ad-types";
import { compareLabel, firstName, liveByClicks, longDate, rangeLabel } from "@/lib/frontend/sponsor-insights-rules";
import { useHub } from "../context";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";
import { AccountNoticeBanner, BalanceHero } from "./insights-balance";
import { LiveCampaigns, PlacementPanel } from "./insights-campaigns";
import { firstError, LoadError, useSponsorData, type Load } from "./insights-data";
import { KpiGrid, type KpiKey } from "./insights-kpis";
import { TrendPanel } from "./insights-trend";

/**
 * Beranda sponsor: sapaan + tanggal, status akun, kartu saldo, KPI 7 hari (vs 7 hari sebelumnya,
 * sparkline), tren 30 hari satu metrik, kampanye aktif, dan penjelasan tempat iklan tampil.
 */
const HOME_KPIS: readonly KpiKey[] = ["impressions", "clicks", "ctr", "spend"];

function useHomeData(version: number) {
  return {
    profile: useSponsorData<SponsorDto>("/sponsor/profile", version),
    balance: useSponsorData<SponsorBalanceDto>("/sponsor/balance", version),
    ads: useSponsorData<AdDto[]>("/sponsor/ads?limit=100", version),
    summary: useSponsorData<AnalyticsSummary>("/sponsor/analytics/summary?preset=7d", version),
    series: useSponsorData<AnalyticsSeries>("/sponsor/analytics/timeseries?preset=30d", version),
    perf: useSponsorData<AdPerformanceDto[]>("/sponsor/analytics/ads?preset=7d&sort=clicks&limit=50", version),
  };
}

export function SponsorHome() {
  const { me } = useHub();
  const [version, setVersion] = useState(0);
  const { profile, balance, ads, summary, series, perf } = useHomeData(version);
  const companyName = profile.data?.companyName ?? me.sponsor?.companyName ?? "";
  const topAd = liveByClicks(ads.data ?? [], perf.data ?? [])[0] ?? null;
  return <div className="dashboard sponsor-home">
    <div className="page-heading"><div><h1>Selamat datang, {firstName(me.user.name)}</h1><p>{longDate(new Date())}{companyName && ` · ${companyName}`}</p></div></div>
    <AccountNoticeBanner profile={profile.data} />
    <LoadError message={firstError(profile, balance, ads, summary, series, perf)} onRetry={() => setVersion(v => v + 1)} />
    <BalanceHero balance={balance.data} weekSpend={summary.data?.kpis.spend.value ?? null} />
    <WeekKpis summary={summary} series={series} />
    <div className="sponsor-columns trend-row">
      <TrendPanel title="Tren 30 hari" note={series.data ? rangeLabel(series.data.period) : undefined} days={series.data?.days ?? null} loading={series.loading} />
      <LiveCampaigns ads={ads.data} perf={perf.data} />
    </div>
    <PlacementPanel ad={topAd} companyName={companyName || "Nama perusahaan Anda"} />
  </div>;
}

function WeekKpis({ summary, series }: { summary: Load<AnalyticsSummary>; series: Load<AnalyticsSeries> }) {
  return <section className="insight-block" aria-labelledby="sponsor-week-title">
    <div className="insight-block-head">
      <div><h2 id="sponsor-week-title">7 hari terakhir</h2>{summary.data && <span>{rangeLabel(summary.data.period)}</span>}</div>
      <HubLink href="/hub/analytics" className="text-link">Lihat analitik<Icon name="arrow" size={15} /></HubLink>
    </div>
    <KpiGrid keys={HOME_KPIS} summary={summary.data} days={series.data?.days.slice(-7) ?? null} compareLabel={compareLabel("7d")} loading={summary.loading} />
  </section>;
}
