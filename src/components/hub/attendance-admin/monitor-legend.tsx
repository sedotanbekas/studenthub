import { number } from "@/lib/frontend/format";
import { MONITOR_STATUSES, STATUS_META, countOf, statusClass, type MapCounts } from "./monitor-rules";

/** Legenda di bawah peta: swatch berhuruf + label + jumlah, lalu ringkasan di luar radius & anomali. */
export function MonitorLegend({ counts, outside, anomalies }: { counts: MapCounts; outside: number; anomalies: number }) {
  return <ul className="monitor-legend" aria-label="Legenda peta">
    {MONITOR_STATUSES.map(status => <li key={status}>
      <span className={`att-swatch ${statusClass(status)}`} aria-hidden="true">{STATUS_META[status].letter}</span>
      {STATUS_META[status].label}<b>{number(countOf(counts, status))}</b>
    </li>)}
    <li className="is-extra"><span className="att-swatch is-outside" aria-hidden="true" />{number(outside)} di luar radius</li>
    <li className="is-extra"><span className="att-swatch is-flag" aria-hidden="true">!</span>{number(anomalies)} perlu ditinjau</li>
  </ul>;
}
