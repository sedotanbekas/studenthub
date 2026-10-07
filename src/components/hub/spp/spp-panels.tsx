"use client";
import { useId } from "react";
import { number, rupiah } from "@/lib/frontend/format";
import { CHILD_TITLES, overdueShare, percentText, periodLabel, SPP_CATEGORIES, trendSeries, type ChildLevel, type SppAnalytics } from "@/lib/frontend/spp-analytics-rules";
import { BarList } from "../charts/bar-list";
import { DonutChart } from "../charts/donut-chart";
import { StatTile } from "../charts/stat-tile";
import { TrendChart } from "../charts/trend-chart";
import { Icon } from "../icon";

/** Panel Analitik SPP: ringkasan, sebaran status, tren per bulan tagihan, rincian lingkup, dan siswa menunggak. */
export function SppSummary({ data }: { data: SppAnalytics }) {
  const t = data.totals;
  const share = overdueShare(t);
  return <div className="insight-kpis spp-kpis">
    <StatTile icon="wallet" label="Total tagihan" value={rupiah(t.billed)} note={`${number(t.invoices)} tagihan · ${number(t.students)} siswa`} neutral />
    <StatTile icon="check" label="Terbayar" value={rupiah(t.paid)} note={`Tingkat penagihan ${percentText(t.collectionRate)}`} neutral />
    <StatTile icon="calendar" label="Menunggak" value={rupiah(t.overdue.amount)} note={`${number(t.overdue.count)} tagihan · ${number(t.overdueStudents)} siswa${share !== null ? ` · ${percentText(share)} tagihan` : ""}`} neutral />
    <StatTile icon="history" label="Lunas telat" value={number(t.late.count)} note={`${number(t.lateStudents)} siswa membayar setelah jatuh tempo`} neutral />
  </div>;
}

export function SppStatusPanel({ data }: { data: SppAnalytics }) {
  const t = data.totals;
  const segments = SPP_CATEGORIES.map(c => ({ key: c.key, label: c.label, value: t[c.key].count, color: c.color }));
  const total = segments.reduce((a, s) => a + s.value, 0);
  return <section className="panel insight-panel" aria-label="Sebaran status tagihan">
    <div className="insight-heading"><div><h2>Status tagihan</h2><p>Jumlah tagihan per status. Sisa tunggakan {rupiah(t.overdue.amount)}, belum jatuh tempo {rupiah(t.notDue.amount)}.</p></div></div>
    {total === 0 ? <p className="empty-line"><Icon name="wallet" size={22} />Belum ada tagihan pada periode ini.</p>
      : <div className="spp-donut"><DonutChart segments={segments} centerLabel="tagihan" centerValue={number(total)} ariaLabel="Sebaran status tagihan SPP" /></div>}
  </section>;
}

export function SppTrendPanel({ data, loading }: { data: SppAnalytics; loading: boolean }) {
  return <section className="panel insight-panel" aria-label="Tren status tagihan per bulan">
    <div className="insight-heading"><div><h2>Tren per bulan tagihan</h2><p>{periodLabel(data.period.from)} – {periodLabel(data.period.to)}. Status dihitung per {data.asOf}.</p></div></div>
    <TrendChart labels={data.trend.map(t => t.period)} series={trendSeries(data.trend)} mode="stacked" labelFormat={periodLabel} titleFormat={periodLabel} format={number}
      footer={i => { const row = data.trend[i]; return row ? `Menunggak ${rupiah(row.overdue.amount)} · terbayar ${percentText(row.collectionRate)}` : null; }}
      ariaLabel="Jumlah tagihan per status per bulan" loading={loading} />
  </section>;
}

interface BreakdownProps { readonly data: SppAnalytics; readonly onSelect: ((child: ChildLevel, key: string) => void) | null }

export function SppBreakdownPanel({ data, onSelect }: BreakdownProps) {
  const headingId = useId();
  const rows = data.breakdown;
  const child = data.scope.childLevel;
  const items = rows.slice(0, 10).map(r => ({ key: r.key, label: r.label, value: r.overdue.amount, valueText: rupiah(r.overdue.amount), detail: `${number(r.overdueStudents)} siswa menunggak · terbayar ${percentText(r.collectionRate)}`, color: "var(--att-alpha)" }));
  return <section className="panel insight-panel" aria-labelledby={headingId}>
    <div className="insight-heading"><div><h2 id={headingId}>{CHILD_TITLES[child]}</h2><p>{onSelect && child !== "class" ? "Pilih baris untuk melihat lebih rinci." : "Tunggakan per kelas di sekolah ini."}</p></div></div>
    {!rows.length ? <p className="empty-line"><Icon name="school" size={22} />Belum ada data.</p> : <>
      <BarList items={items} format={rupiah} ariaLabel={`Tunggakan ${CHILD_TITLES[child].toLowerCase()}`} onSelect={onSelect && child !== "class" ? key => onSelect(child, key) : undefined} />
      <div className="table-scroll"><table className="perf-table spp-table">
        <thead><tr><th scope="col">{CHILD_TITLES[child].replace("Per ", "")}</th><th scope="col">Tepat waktu</th><th scope="col">Telat</th><th scope="col">Menunggak</th><th scope="col">Sisa tunggakan</th><th scope="col">Terbayar</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.key}><th scope="row">{onSelect && child !== "class" ? <button type="button" className="text-button" onClick={() => onSelect(child, r.key)}>{r.label}</button> : r.label}</th>
          <td data-label="Tepat waktu">{number(r.onTime.count)}</td><td data-label="Telat">{number(r.late.count)}</td><td data-label="Menunggak">{number(r.overdue.count)}</td>
          <td data-label="Sisa tunggakan">{rupiah(r.overdue.amount)}</td><td data-label="Terbayar">{percentText(r.collectionRate)}</td></tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}

export function SppStudentsPanel({ data }: { data: SppAnalytics }) {
  const headingId = useId();
  const top = data.students.filter(s => s.outstanding > 0).slice(0, 10);
  return <section className="panel insight-panel" aria-labelledby={headingId}>
    <div className="insight-heading"><div><h2 id={headingId}>Siswa menunggak & telat bayar</h2><p>Paling banyak 50 siswa, tunggakan terbesar lebih dulu.</p></div></div>
    {!data.students.length ? <p className="empty-line"><Icon name="check" size={22} />Tidak ada siswa menunggak atau telat bayar pada periode ini.</p> : <>
      {top.length > 0 && <BarList items={top.map(s => ({ key: s.studentId, label: s.name, value: s.outstanding, valueText: rupiah(s.outstanding), detail: `${s.className ?? "Tanpa kelas"} · ${s.schoolName}`, color: "var(--att-alpha)" }))} format={rupiah} ariaLabel="Tunggakan per siswa" />}
      <div className="table-scroll"><table className="perf-table spp-table">
        <thead><tr><th scope="col">Siswa</th><th scope="col">Kelas</th><th scope="col">Sekolah</th><th scope="col">Tagihan menunggak</th><th scope="col">Sisa tunggakan</th><th scope="col">Jatuh tempo terlama</th><th scope="col">Lunas telat</th></tr></thead>
        <tbody>{data.students.map(s => <tr key={s.studentId}><th scope="row"><strong>{s.name}</strong><small className="spp-sub">NISN {s.nisn}</small></th>
          <td data-label="Kelas">{s.className ?? "—"}</td><td data-label="Sekolah">{s.schoolName}</td><td data-label="Tagihan menunggak">{number(s.overdueInvoices)}</td>
          <td data-label="Sisa tunggakan">{rupiah(s.outstanding)}</td><td data-label="Jatuh tempo terlama">{s.oldestDueDate ?? "—"}</td><td data-label="Lunas telat">{number(s.lateInvoices)}</td></tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
