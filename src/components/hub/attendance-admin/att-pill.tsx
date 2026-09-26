import { STATUS_META, statusClass, type MonitorStatus } from "./monitor-rules";

/** Pill status kehadiran dengan warna yang sama dengan pin peta, chip, dan legenda. */
export function AttPill({ status }: { status: MonitorStatus }) {
  return <span className={`att-pill ${statusClass(status)}`}><i aria-hidden="true" />{STATUS_META[status].label}</span>;
}
