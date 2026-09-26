"use client";
import type { DashboardSummaryDto } from "@/lib/dashboard/schemas";
import { monthOf, schoolToday } from "@/lib/frontend/school-chart-rules";
import { useHub } from "./context";
import { ClassPanel } from "./school-charts/class-panel";
import { MonthTile } from "./school-charts/month-tile";
import { TodayPanel } from "./school-charts/today-panel";
import { TrendPanel } from "./school-charts/trend-panel";

/**
 * Grafik beranda admin sekolah. Desktop: donat hari ini di samping (kartu bulan ini + tren), lalu
 * kehadiran per kelas selebar penuh; HP/tablet: satu kolom dengan urutan yang sama. Tiap panel memuat
 * datanya sendiri sehingga satu panel yang gagal tidak menyembunyikan panel lain. "Hari ini"
 * mengikuti zona waktu sekolah.
 */
export function SchoolCharts({ summary }: { summary: DashboardSummaryDto | null }) {
  const { me } = useHub();
  const today = schoolToday(me.school?.timezone);
  const month = monthOf(today);
  return <div className="school-charts">
    <TodayPanel summary={summary} />
    <div className="sc-col-main">
      <MonthTile month={month} />
      <TrendPanel today={today} />
    </div>
    <ClassPanel month={month} />
  </div>;
}
