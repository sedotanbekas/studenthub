"use client";
import type { DashboardSummaryDto } from "@/lib/dashboard/schemas";
import { number } from "@/lib/frontend/format";
import { pctText, todayCaption, todaySegments } from "@/lib/frontend/school-chart-rules";
import { DonutChart } from "../charts/donut-chart";
import { HubLink } from "../hub-link";
import { Icon } from "../icon";
import { PanelEmpty, PanelSkeleton } from "./panel-state";

/**
 * Panel "Kehadiran hari ini": donat enam status (hover/tap segmen atau legenda -> disorot, angka
 * tengah berganti). Angka tengah = hadir tepat waktu + terlambat (segmen "Hadir" hanya yang tepat
 * waktu), jadi labelnya menyebut keduanya. Data dari ringkasan dasbor (props), tanpa request sendiri.
 */
export function TodayPanel({ summary }: { summary: DashboardSummaryDto | null }) {
  const today = summary?.attendanceToday;
  return <section className="panel sc-panel sc-today" aria-labelledby="sc-today-title" aria-busy={!today}>
    <div className="panel-heading">
      <div><h2 id="sc-today-title">Kehadiran hari ini</h2><p>{today ? todayCaption(today) : "Memuat data hari ini…"}</p></div>
    </div>
    {!today ? <PanelSkeleton block lines={2} />
      : today.isSchoolDay ? <DonutChart
        segments={todaySegments(today)}
        centerValue={pctText(today.presentPct)}
        centerLabel="hadir + terlambat"
        ariaLabel={`Kehadiran hari ini: ${pctText(today.presentPct)} hadir (tepat waktu + terlambat) dari ${number(today.eligible)} siswa aktif`}
      />
        : <PanelEmpty icon="calendar" text="Hari ini bukan hari sekolah, jadi tidak ada absensi. Tren hari sebelumnya tetap bisa dilihat di grafik tren." />}
    <HubLink className="text-link sc-link" href="/hub/attendance">Lihat peta kehadiran <Icon name="arrow" size={14} /></HubLink>
  </section>;
}
