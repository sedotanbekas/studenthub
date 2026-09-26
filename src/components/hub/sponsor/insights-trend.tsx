"use client";
import { useId, useState } from "react";
import type { AnalyticsDay } from "@/lib/frontend/ad-types";
import { dayLabel, shortDate } from "@/lib/frontend/chart-rules";
import { formatMetric, METRIC_OPTIONS, metricValues, tailCrowdedDates, trendFooter, trendSummary, type InsightMetric } from "@/lib/frontend/sponsor-insights-rules";
import { Segmented } from "../charts/segmented";
import { TrendChart } from "../charts/trend-chart";
import { useElementWidth } from "../charts/use-width";

/** Margin kiri+kanan area plot TrendChart (sumbu-y 44px + 12px). */
const PLOT_INSET = 56;

/**
 * Panel tren harian sponsor: SATU metrik pada satu waktu (dipilih lewat kontrol segmen, tanpa dua
 * sumbu-y), area berwarna primer, tooltip memuat metrik lain hari itu, dan ringkasan total/rata-rata/
 * hari tertinggi di atas grafik. Jumlah label sumbu-x diatur TrendChart (xLabelCount menurut lebar);
 * di sini hanya label yang menimpa label terakhir yang dikosongkan (tailCrowdedDates).
 */
interface TrendPanelProps {
  readonly title: string;
  readonly note?: string;
  readonly days: readonly AnalyticsDay[] | null;
  readonly loading: boolean;
}

export function TrendPanel({ title, note, days, loading }: TrendPanelProps) {
  const [metric, setMetric] = useState<InsightMetric>("impressions");
  const headingId = useId();
  const option = METRIC_OPTIONS.find(o => o.value === metric) ?? METRIC_OPTIONS[0]!;
  const list = days ?? [];
  const values = metricValues(list, metric);
  const format = (value: number) => formatMetric(metric, value);
  const labels = list.map(d => d.date);
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const crowded = tailCrowdedDates(labels, width - PLOT_INSET);
  return <section className="panel insight-panel" aria-labelledby={headingId}>
    <div className="insight-heading">
      <div><h2 id={headingId}>{title}</h2>{note && <p>{note}</p>}</div>
      <Segmented options={METRIC_OPTIONS} value={metric} onChange={setMetric} ariaLabel="Metrik grafik tren" />
    </div>
    {days && <TrendFacts days={list} values={values} metric={metric} />}
    <div ref={ref} className="trend-canvas">
      {days ? <TrendChart labels={labels} series={[{ key: metric, label: option.label, color: "var(--primary)", values }]} mode="area" height={220}
        format={format} labelFormat={date => (crowded.has(date) ? "" : shortDate(date))}
        titleFormat={date => (date === labels[labels.length - 1] ? `${dayLabel(date)} · hari ini, masih berjalan` : dayLabel(date))} footer={i => { const day = list[i]; return day ? trendFooter(day, metric) : null; }}
        ariaLabel={`${option.label} per hari, ${title.toLowerCase()}`} loading={loading} />
        : <div className="chart-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton block" /></div>}
    </div>
  </section>;
}

function TrendFacts({ days, values, metric }: { days: readonly AnalyticsDay[]; values: readonly number[]; metric: InsightMetric }) {
  const { total, average, peak } = trendSummary(values);
  const peakDay = peak === null ? undefined : days[peak];
  return <dl className="trend-facts">
    <div><dt>Total</dt><dd>{formatMetric(metric, total)}<small>{days.length} hari</small></dd></div>
    <div><dt>Rata-rata</dt><dd>{formatMetric(metric, average)}<small>per hari</small></dd></div>
    <div><dt>Tertinggi</dt><dd>{peakDay ? <>{formatMetric(metric, values[peak ?? 0] ?? 0)}<small>{dayLabel(peakDay.date)}</small></> : "—"}</dd></div>
  </dl>;
}
