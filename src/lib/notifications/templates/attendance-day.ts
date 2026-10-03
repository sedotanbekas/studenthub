import { alphaNoticeKey, daySummaryKey, leaveDeadlineFor, type DayCounts } from "@/lib/attendance/day-notice-rules";
import type { LeaveTypeValue } from "@/lib/attendance/leave-constants";
import type { NotificationEvent, SchoolAdminBroadcastEvent } from "../notify";
import { formatIndonesianDate } from "./attendance-admin";

/**
 * Teks notifikasi saat hari sekolah ditutup (N4; murni, dipakai juga mode demo agar teksnya identik).
 * Siswa: "kamu" seperti layar absen siswa. Tautan: attendance-alpha (tanggal) / leave-request (pengajuan) /
 * attendance-day (tanggal, admin).
 */

/** "2031-03-18" -> "Selasa, 18 Maret" (tanpa tahun, untuk judul pendek). */
const shortDate = (date: string): string => formatIndonesianDate(date).replace(/ \d{4}$/, "");

const alphaTitle = (date: string): string => `Alpa pada ${shortDate(date)}`;

const KIND_LOWER: Readonly<Record<LeaveTypeValue, string>> = { IZIN: "izin", SAKIT: "sakit" };

export const ALPHA_HOLD_LINE =
  "Belum ada siswa yang absen lewat aplikasi pada tanggal ini — notifikasi Alpa ke siswa ditahan. Libur? Tambahkan di Kalender.";

export function attendanceAlphaNotification(info: { readonly date: string }): NotificationEvent {
  return {
    type: "ATTENDANCE_ALPHA",
    title: alphaTitle(info.date),
    body: `Kamu tercatat Alpa pada ${formatIndonesianDate(info.date)}. Bila berhalangan, ajukan izin/sakit paling lambat ${formatIndonesianDate(leaveDeadlineFor(info.date))}.`,
    link: { screen: "attendance-alpha", id: info.date },
    dedupKey: alphaNoticeKey(info.date),
  };
}

export interface AlphaPendingInfo {
  readonly date: string;
  readonly leaveId: string;
  readonly type: LeaveTypeValue;
}

export function attendanceAlphaPendingNotification(info: AlphaPendingInfo): NotificationEvent {
  return {
    type: "ATTENDANCE_ALPHA",
    title: alphaTitle(info.date),
    body: `Kamu tercatat Alpa pada ${formatIndonesianDate(info.date)} karena pengajuan ${KIND_LOWER[info.type]} kamu belum disetujui. Status berubah otomatis bila disetujui.`,
    link: { screen: "leave-request", id: info.leaveId },
    dedupKey: alphaNoticeKey(info.date),
  };
}

export interface DaySummaryInfo {
  readonly date: string;
  readonly counts: DayCounts;
  /** Notifikasi Alpa ke siswa ditahan (tanpa satu pun check-in). */
  readonly alphaHeld: boolean;
}

export function attendanceDaySummaryNotification(info: DaySummaryInfo): SchoolAdminBroadcastEvent {
  const c = info.counts;
  const parts = [`Alpa ${c.alpha} · Terlambat ${c.late} · Izin ${c.izin} · Sakit ${c.sakit}.`];
  if (c.pendingAnomalies > 0) parts.push(`${c.pendingAnomalies} perlu ditinjau.`);
  if (info.alphaHeld) parts.push(ALPHA_HOLD_LINE);
  return {
    type: "ATTENDANCE_DAY_SUMMARY",
    title: `Rekap kehadiran ${formatIndonesianDate(info.date)}`,
    body: parts.join(" "),
    link: { screen: "attendance-day", id: info.date },
    dedupKey: daySummaryKey(info.date),
  };
}
