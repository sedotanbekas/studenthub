"use client";
import { isSummaryAnalytics, monthMix, monthName, monthTileNote, pctText } from "@/lib/frontend/school-chart-rules";
import { StatTile } from "../charts/stat-tile";
import { PanelError } from "./panel-state";
import { useAnalytics } from "./use-analytics";

const LABEL = "Kehadiran bulan ini";

/**
 * Kartu "Kehadiran bulan ini": persen hadir sekolah + selisih poin terhadap bulan lalu, ditambah
 * rincian terlambat/izin/sakit/alpa bulan ini (angka ditulis, kotak warna hanya penanda).
 */
export function MonthTile({ month }: { month: string }) {
  const { state, retry } = useAnalytics(`/school/attendance/analytics/summary?month=${month}`, isSummaryAnalytics);
  if (state.status !== "ready") {
    return <div className="stat-card sc-month" aria-busy={state.status === "loading"}>
      <div><span>{LABEL}</span></div>
      {state.status === "error" ? <PanelError message={state.message} onRetry={retry} /> : <><div className="skeleton sc-skeleton-value" /><div className="skeleton" /></>}
    </div>;
  }
  const s = state.data;
  const hasCompare = s.presentPct !== null && s.prevPresentPct !== null;
  return <div className="stat-card sc-month">
    <StatTile
      label={LABEL}
      value={pctText(s.presentPct)}
      icon="calendar"
      change={hasCompare ? s.deltaPp : undefined}
      changeUnit=" poin"
      compareLabel={hasCompare ? `vs ${monthName(s.prevMonth)}` : undefined}
      note={monthTileNote(s)}
    />
    {s.presentPct !== null && <dl className="sc-month-mix" aria-label="Rincian bulan ini selain hadir tepat waktu">
      {monthMix(s).map(m => <div key={m.key}><dt><i className="key box" style={{ background: m.color }} aria-hidden="true" />{m.label}</dt><dd>{m.text}</dd></div>)}
    </dl>}
  </div>;
}
