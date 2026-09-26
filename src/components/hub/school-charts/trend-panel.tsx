"use client";
import { useMemo, useState } from "react";
import { dayLabel, shortDate } from "@/lib/frontend/chart-rules";
import { number } from "@/lib/frontend/format";
import { compactDate, countAxisLabel, isSchoolTrend, lastDays, pctText, trendDays, trendFooterText, trendHighlights, trendRange, trendSeries, type TrendDay, type TrendFocus } from "@/lib/frontend/school-chart-rules";
import { Segmented } from "../charts/segmented";
import { TrendChart } from "../charts/trend-chart";
import { useElementWidth } from "../charts/use-width";
import { PanelError, PanelSkeleton } from "./panel-state";
import { useAnalytics } from "./use-analytics";

/**
 * Panel "Tren kehadiran": kolom bertumpuk jumlah siswa per status per hari. Data 30 hari diambil
 * sekali; pilihan 14 hari memotong di klien (tanpa request baru). Hari non-sekolah = kolom kosong.
 * Fokus "Selain hadir" membuang seri Hadir agar skala memperbesar terlambat/izin/sakit/alpa.
 */
type PeriodValue = "14" | "30";
const FETCH_DAYS = 30;
/** Di bawah lebar ini label sumbu x memakai format ringkas "27/8" agar tidak bertabrakan. */
const COMPACT_WIDTH = 520;
const PERIOD_OPTIONS: ReadonlyArray<{ value: PeriodValue; label: string }> = [{ value: "14", label: "14 hari" }, { value: "30", label: "30 hari" }];
const FOCUS_OPTIONS: ReadonlyArray<{ value: TrendFocus; label: string }> = [{ value: "all", label: "Semua status" }, { value: "absent", label: "Selain hadir" }];

export function TrendPanel({ today }: { today: string }) {
  const range = trendRange(FETCH_DAYS, today);
  const { state, retry } = useAnalytics(`/school/attendance/analytics/trend?from=${range.from}&to=${range.to}`, isSchoolTrend);
  const [period, setPeriod] = useState<PeriodValue>("30");
  const [focus, setFocus] = useState<TrendFocus>("all");
  const allDays = useMemo(() => (state.status === "ready" ? trendDays(state.data) : []), [state]);
  const closedThrough = state.status === "ready" ? state.data.closedThrough : null;
  return <section className="panel sc-panel sc-trend" aria-labelledby="sc-trend-title" aria-busy={state.status === "loading"}>
    <div className="panel-heading">
      <div>
        <h2 id="sc-trend-title">Tren kehadiran</h2>
        <p>Jumlah siswa per status tiap hari{closedThrough ? ` · data s.d. ${dayLabel(closedThrough)} (hari ini belum termasuk)` : ""}</p>
      </div>
      <div className="sc-controls">
        <Segmented options={FOCUS_OPTIONS} value={focus} onChange={setFocus} ariaLabel="Status yang ditampilkan" />
        <Segmented options={PERIOD_OPTIONS} value={period} onChange={setPeriod} ariaLabel="Periode tren kehadiran" />
      </div>
    </div>
    {state.status === "error" ? <PanelError message={state.message} onRetry={retry} />
      : state.status === "loading" ? <PanelSkeleton block lines={1} />
        : <TrendBody days={lastDays(allDays, Number(period))} period={period} focus={focus} />}
  </section>;
}

function TrendBody({ days, period, focus }: { days: readonly TrendDay[]; period: PeriodValue; focus: TrendFocus }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const highlights = trendHighlights(days);
  const lowest = highlights.lowest;
  return <>
    <dl className="sc-highlights">
      <div><dt>Rata-rata hadir</dt><dd>{pctText(highlights.averagePct)}</dd></div>
      <div><dt>Hari terendah</dt><dd>{lowest ? <>{pctText(lowest.presentPct)} <small>{dayLabel(lowest.date)}</small></> : "—"}</dd></div>
      <div><dt>Hari sekolah</dt><dd>{number(highlights.schoolDays)}</dd></div>
    </dl>
    <div ref={ref} className="sc-chart">
      <TrendChart
        labels={days.map(d => d.date)}
        series={trendSeries(days, focus)}
        mode="stacked"
        format={number}
        axisFormat={countAxisLabel}
        labelFormat={width > 0 && width < COMPACT_WIDTH ? compactDate : shortDate}
        footer={i => trendFooterText(days[i])}
        ariaLabel={`Jumlah siswa per status kehadiran${focus === "absent" ? " selain hadir tepat waktu" : ""}, ${period} hari terakhir sampai kemarin`}
      />
    </div>
    <p className="sc-hint">Arahkan atau geser jari di grafik untuk membaca angka per hari; ketuk status di legenda untuk menyembunyikannya. Angka hari ini ada di panel Kehadiran hari ini.</p>
  </>;
}
