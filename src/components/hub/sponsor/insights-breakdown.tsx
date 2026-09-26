"use client";
import { useId } from "react";
import type { AnalyticsBreakdown } from "@/lib/frontend/ad-types";
import { number } from "@/lib/frontend/format";
import { breakdownBars } from "@/lib/frontend/sponsor-insights-rules";
import { BarList } from "../charts/bar-list";

/** Sebaran klik per perangkat / provinsi sekolah: batang satu warna, porsi di rincian baris. */
export function BreakdownPanel({ title, note, data, loading }: { title: string; note: string; data: AnalyticsBreakdown | null; loading: boolean }) {
  const headingId = useId();
  return <section className="panel insight-panel" aria-labelledby={headingId}>
    <div className="insight-heading"><div><h2 id={headingId}>{title}</h2><p>{note}</p></div></div>
    {data
      ? <div className={loading ? "is-loading" : undefined}><BarList items={breakdownBars(data.items)} format={number} ariaLabel={`Klik per ${title.toLowerCase()}`} /></div>
      : <div className="chart-skeleton" aria-hidden="true"><span className="skeleton" /><span className="skeleton" /><span className="skeleton" /></div>}
  </section>;
}
