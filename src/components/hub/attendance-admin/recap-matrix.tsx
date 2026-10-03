"use client";
import { memo } from "react";
import { cellDisplay } from "@/lib/attendance/monthly-recap-rules";
import type { MonthlyRecapDto } from "@/lib/attendance/monthly-recap-schemas";
import { label } from "@/lib/frontend/format";
import { RECAP_LEGEND, cellTitle, lateReasonChips, otherClassBadge, weekdayAbbr } from "./recap-view-rules";

/**
 * Tampilan rekap bulanan (A3): matriks per tanggal (penggulung horizontal sendiri; No & Nama menempel) dan daftar
 * ringkas untuk HP. Setiap sel menampilkan hurufnya — makna tidak pernah hanya dari warna.
 */

type Recap = MonthlyRecapDto;
type Student = Recap["students"][number];
type Tally = Recap["totals"];

const pctText = (value: number | null) => (value === null ? "–" : String(value).replace(".", ","));
const TOTAL_HEADS = [["H", "Hadir"], ["T", "Terlambat"], ["I", "Izin"], ["S", "Sakit"], ["A", "Alpa"], ["%", "Kehadiran (%)"], ["Menit", "Menit terlambat"]] as const;
const totalCells = (t: Tally) => [t.hadir, t.terlambat, t.izin, t.sakit, t.alpha, pctText(t.presentPct), t.lateMinutes];

function Badges({ student }: { student: Student }) {
  const moved = otherClassBadge(student.otherClasses);
  if (!moved && student.studentStatus === "ACTIVE") return null;
  return <span className="recap-badges">
    {moved && <span className="row-tag is-neutral" title={moved.title}>{moved.text}</span>}
    {student.studentStatus !== "ACTIVE" && <span className="row-tag is-warning">{label(student.studentStatus)}</span>}
  </span>;
}

const GridRow = memo(function GridRow({ index, student, days }: { index: number; student: Student; days: Recap["days"] }) {
  return <tr>
    <td className="recap-sticky recap-no">{index + 1}</td>
    <th scope="row" className="recap-sticky recap-name"><span>{student.name}</span><small>NIS {student.nis}</small><Badges student={student} /></th>
    {days.map((day, i) => {
      const shown = cellDisplay(day, student.cells[i] ?? null);
      return <td key={day.date} className={`recap-cell s-${shown.tone}`} title={cellTitle(day, shown)}>{shown.text}</td>;
    })}
    {totalCells(student.totals).map((value, i) => <td key={TOTAL_HEADS[i]![0]} className="recap-total">{value}</td>)}
  </tr>;
});

export function RecapGrid({ recap }: { recap: Recap }) {
  return <div className="recap-scroll" role="region" tabIndex={0} aria-label={`Rekap ${recap.class.name} ${recap.monthLabel} per tanggal (geser ke samping)`}>
    <table className="recap-table">
      <thead><tr>
        <th scope="col" className="recap-sticky recap-no">No</th>
        <th scope="col" className="recap-sticky recap-name">Nama</th>
        {recap.days.map(d => <th key={d.date} scope="col" className={`recap-day${d.reason === "SCHOOL_DAY" ? "" : " is-off"}`} title={d.holidayName ?? undefined}><span>{d.day}</span><small>{weekdayAbbr(d.weekday)}</small></th>)}
        {TOTAL_HEADS.map(([text, title]) => <th key={text} scope="col" className="recap-total" title={title}>{text}</th>)}
      </tr></thead>
      <tbody>{recap.students.map((s, i) => <GridRow key={s.studentId} index={i} student={s} days={recap.days} />)}</tbody>
      <tfoot><tr>
        <th scope="row" colSpan={2} className="recap-sticky recap-name recap-foot">Jumlah kelas</th>
        {recap.days.map(d => <td key={d.date} aria-hidden="true" />)}
        {totalCells(recap.totals).map((value, i) => <td key={TOTAL_HEADS[i]![0]} className="recap-total">{value}</td>)}
      </tr></tfoot>
    </table>
  </div>;
}

export function RecapCompact({ recap }: { recap: Recap }) {
  return <ul className="recap-compact">{recap.students.map(s => {
    const chips = lateReasonChips(s.totals);
    return <li key={s.studentId}>
      <div className="recap-compact-head"><span><strong>{s.name}</strong><small>NIS {s.nis}</small></span><b className="recap-compact-pct">{pctText(s.totals.presentPct)}{s.totals.presentPct === null ? "" : "%"}</b></div>
      <Badges student={s} />
      <dl className="recap-compact-totals">
        <div><dt>Hadir</dt><dd>{s.totals.hadir}</dd></div><div><dt>Terlambat</dt><dd>{s.totals.terlambat}{s.totals.lateMinutes ? <small>{s.totals.lateMinutes} menit</small> : null}</dd></div>
        <div><dt>Izin</dt><dd>{s.totals.izin}</dd></div><div><dt>Sakit</dt><dd>{s.totals.sakit}</dd></div><div><dt>Alpa</dt><dd>{s.totals.alpha}</dd></div>
      </dl>
      {chips.length > 0 && <ul className="recap-chips" aria-label="Alasan terlambat">{chips.map(c => <li key={c.label}>{c.label} · {c.count}</li>)}</ul>}
    </li>;
  })}</ul>;
}

export function RecapLegend() {
  return <ul className="recap-legend" aria-label="Keterangan kode">{RECAP_LEGEND.map(([code, meaning, tone]) =>
    <li key={meaning}><span className={`recap-cell s-${tone}`} aria-hidden="true">{code}</span>{meaning}</li>)}</ul>;
}
