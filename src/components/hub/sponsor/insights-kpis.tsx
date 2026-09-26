"use client";
import type { AnalyticsDay, AnalyticsSummary } from "@/lib/frontend/ad-types";
import { number, rupiah } from "@/lib/frontend/format";
import { ctrValues, formatCtr } from "@/lib/frontend/sponsor-insights-rules";
import { StatTile } from "../charts/stat-tile";

/**
 * Baris kartu KPI sponsor: nilai periode, perubahan vs periode sebelumnya (dari API), dan sparkline
 * harian. Biaya bersifat informasi (tanpa warna baik/buruk). Kerangka ditampilkan sebelum data pertama.
 */
export type KpiKey = keyof AnalyticsSummary["kpis"];

interface KpiSpec {
  readonly label: string;
  readonly icon: string;
  readonly neutral?: boolean;
  readonly format: (value: number | null) => string;
  readonly spark: (days: readonly AnalyticsDay[]) => number[];
}

const count = (value: number | null): string => number(value ?? 0);
const SPECS: Record<KpiKey, KpiSpec> = {
  impressions: { label: "Tayangan", icon: "eye", format: count, spark: days => days.map(d => d.impressions) },
  clicks: { label: "Klik", icon: "spark", format: count, spark: days => days.map(d => d.clicks) },
  uniqueClicks: { label: "Klik unik", icon: "users", format: count, spark: days => days.map(d => d.uniqueClicks) },
  ctr: { label: "CTR", icon: "chart", format: formatCtr, spark: ctrValues },
  chargedClicks: { label: "Klik ditagih", icon: "check", format: count, spark: days => days.map(d => d.chargedClicks) },
  spend: { label: "Biaya", icon: "wallet", neutral: true, format: value => rupiah(value ?? 0), spark: days => days.map(d => d.spend) },
};

interface KpiGridProps {
  readonly keys: readonly KpiKey[];
  readonly summary: AnalyticsSummary | null;
  readonly days: readonly AnalyticsDay[] | null;
  readonly compareLabel: string;
  readonly loading: boolean;
}

export function KpiGrid({ keys, summary, days, compareLabel, loading }: KpiGridProps) {
  return <div className={`insight-kpis cols-${keys.length}${loading && summary ? " is-loading" : ""}`} aria-busy={loading}>
    {keys.map(key => {
      const spec = SPECS[key];
      const kpi = summary?.kpis[key];
      if (!kpi) return <KpiSkeleton key={key} label={spec.label} />;
      const spark = days ? spec.spark(days) : [];
      // Deret nol semua tidak bercerita apa-apa: sparkline disembunyikan.
      return <StatTile key={key} label={spec.label} icon={spec.icon} value={spec.format(kpi.value)} change={kpi.changePct} neutral={spec.neutral} compareLabel={compareLabel} spark={spark.some(v => v > 0) ? spark : undefined} />;
    })}
  </div>;
}

function KpiSkeleton({ label }: { label: string }) {
  return <div className="stat-card stat-tile kpi-skeleton">
    <div><span>{label}</span></div>
    <span className="skeleton wide" aria-hidden="true" />
    <span className="skeleton" aria-hidden="true" />
  </div>;
}
