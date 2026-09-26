"use client";
import { useState } from "react";
import { shortDate } from "@/lib/frontend/chart-rules";
import { ATTENTION_PCT, classRows, isClassAnalytics, splitClasses, type ClassRow } from "@/lib/frontend/school-chart-rules";
import { BarList, type BarItem } from "../charts/bar-list";
import { Icon } from "../icon";
import { PanelEmpty, PanelError, PanelSkeleton } from "./panel-state";
import { useAnalytics } from "./use-analytics";

/**
 * Panel "Kehadiran per kelas bulan ini": batang persen hadir, terendah di atas. Kelas di bawah
 * ATTENTION_PCT dikelompokkan di bawah judul "Perlu perhatian" (teks + ikon, bukan hanya warna).
 */
const CLASS_LIMIT = 6;
const toItems = (rows: readonly ClassRow[]): BarItem[] => rows.map(r => ({ key: r.key, label: r.label, value: r.value, valueText: r.valueText, detail: r.detail, color: "var(--att-hadir)" }));

export function ClassPanel({ month }: { month: string }) {
  const { state, retry } = useAnalytics(`/school/attendance/analytics/classes?month=${month}`, isClassAnalytics);
  const closedThrough = state.status === "ready" ? state.data.period.closedThrough : null;
  return <section className="panel sc-panel sc-classes" aria-labelledby="sc-classes-title" aria-busy={state.status === "loading"}>
    <div className="panel-heading">
      <div>
        <h2 id="sc-classes-title">Kehadiran per kelas bulan ini</h2>
        <p>Persen hadir (tepat waktu + terlambat), terendah di atas{closedThrough ? ` · data s.d. ${shortDate(closedThrough)}` : ""}</p>
      </div>
    </div>
    {state.status === "error" ? <PanelError message={state.message} onRetry={retry} />
      : state.status === "loading" ? <PanelSkeleton lines={5} />
        : state.data.classes.length === 0 ? <PanelEmpty icon="chart" text="Belum ada catatan kehadiran yang ditutup bulan ini." />
          : <ClassBars rows={classRows(state.data.classes)} />}
  </section>;
}

function ClassBars({ rows }: { rows: readonly ClassRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const { attention, others, hiddenCount } = splitClasses(rows, CLASS_LIMIT, expanded);
  const canToggle = expanded || hiddenCount > 0;
  return <>
    {attention.length > 0
      ? <div className="sc-group sc-group-attention">
        <p className="sc-group-title"><Icon name="bell" size={16} />Perlu perhatian · di bawah {ATTENTION_PCT}%</p>
        <BarList items={toItems(attention)} max={100} ariaLabel={`Kelas dengan kehadiran di bawah ${ATTENTION_PCT}%`} />
      </div>
      : <p className="sc-all-good"><Icon name="check" size={16} />Semua kelas di atas {ATTENTION_PCT}% bulan ini.</p>}
    {others.length > 0 && <div className="sc-group">
      {attention.length > 0 && <p className="sc-group-title">Kelas lainnya</p>}
      <BarList items={toItems(others)} max={100} ariaLabel="Kehadiran kelas lainnya" />
    </div>}
    <div className="sc-classes-foot">
      <span className="sc-threshold-key"><i aria-hidden="true" />Garis = batas perhatian {ATTENTION_PCT}%</span>
      {canToggle && <button type="button" className="text-button sc-more" aria-expanded={expanded} onClick={() => setExpanded(v => !v)}>
        {expanded ? "Tampilkan lebih sedikit" : `Tampilkan ${hiddenCount} kelas lainnya`}
      </button>}
    </div>
  </>;
}
