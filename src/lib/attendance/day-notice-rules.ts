import type { AttendanceStatus } from "@prisma/client";
import { addDays, type LocalDate } from "@/lib/time/zone";
import { LEAVE_MAX_BACKDATE_DAYS, type LeaveTypeValue } from "./leave-constants";

/**
 * Aturan murni notifikasi saat hari sekolah ditutup (N4, keputusan pemilik 2026-10-03): siapa yang diberi tahu,
 * sampai umur berapa, dan kunci dedup per penerima. Tanpa Prisma — dipakai job penutupan & mode demo.
 */

/** Notifikasi Alpa hanya untuk tanggal <= 3 hari lalu (catch-up 7 hari tidak menyerbu siswa). */
export const ALPHA_NOTICE_MAX_AGE_DAYS = 3;
/** Rekap harian admin hanya untuk hari ini/kemarin. */
export const DAY_SUMMARY_MAX_AGE_DAYS = 1;

export const alphaNoticeKey = (date: LocalDate): string => `attendance-alpha:${date}`;
export const daySummaryKey = (date: LocalDate): string => `attendance-summary:${date}`;

/** addDays(today, -max) <= date <= today. */
export function isFreshClose(date: LocalDate, today: LocalDate, maxAgeDays: number): boolean {
  return date <= today && date >= addDays(today, -maxAgeDays);
}

/** Hari terakhir siswa masih boleh mengajukan izin/sakit yang mencakup `date` (batas mundur siswa). */
export const leaveDeadlineFor = (date: LocalDate): LocalDate => addDays(date, LEAVE_MAX_BACKDATE_DAYS);

export interface PendingLeaveRef {
  readonly id: string;
  readonly studentId: string;
  readonly type: LeaveTypeValue;
  readonly startDate: LocalDate;
  readonly endDate: LocalDate;
}

export interface PendingAlphaNotice {
  readonly studentId: string;
  readonly leaveId: string;
  readonly type: LeaveTypeValue;
}

export interface AlphaNoticePlan {
  /** Siswa Alpa tanpa pengajuan tertunda (urut, unik). */
  readonly plain: readonly string[];
  /** Siswa Alpa yang pengajuannya masih menunggu persetujuan (teks & tautan berbeda). */
  readonly pending: readonly PendingAlphaNotice[];
}

const precedes = (a: PendingLeaveRef, b: PendingLeaveRef): boolean => a.startDate < b.startDate || (a.startDate === b.startDate && a.id < b.id);

/** Izin PENDING yang mencakup tanggal per siswa: mulai paling awal, lalu id (sama dengan izin DISETUJUI di auto-alpha). */
export function planAlphaNotices(date: LocalDate, alphaStudentIds: readonly string[], pending: readonly PendingLeaveRef[]): AlphaNoticePlan {
  const ids = [...new Set(alphaStudentIds)].sort();
  const wanted = new Set(ids);
  const covering = new Map<string, PendingLeaveRef>();
  for (const leave of pending) {
    if (!wanted.has(leave.studentId) || leave.startDate > date || leave.endDate < date) continue;
    const current = covering.get(leave.studentId);
    if (!current || precedes(leave, current)) covering.set(leave.studentId, leave);
  }
  return {
    plain: ids.filter((id) => !covering.has(id)),
    pending: ids.flatMap((id) => {
      const leave = covering.get(id);
      return leave ? [{ studentId: id, leaveId: leave.id, type: leave.type }] : [];
    }),
  };
}

export interface DayCounts {
  readonly alpha: number;
  readonly late: number;
  readonly izin: number;
  readonly sakit: number;
  /** Anomali yang belum ditinjau (B1 PENDING_ANOMALY_REVIEW_WHERE). */
  readonly pendingAnomalies: number;
}

export function dayCountsFrom(groups: readonly { readonly status: AttendanceStatus; readonly count: number }[], pendingAnomalies: number): DayCounts {
  const of = (status: AttendanceStatus) => groups.filter((g) => g.status === status).reduce((sum, g) => sum + g.count, 0);
  return { alpha: of("ALPHA"), late: of("TERLAMBAT"), izin: of("IZIN"), sakit: of("SAKIT"), pendingAnomalies };
}

/** Rekap dikirim hanya bila ada yang perlu ditindaklanjuti (izin/sakit saja = tidak). */
export const isNotableDay = (c: DayCounts): boolean => c.alpha + c.late + c.pendingAnomalies > 0;

/**
 * Tanpa satu pun check-in di tanggal itu, Alpa massal hampir pasti salah sebab (libur belum dicatat, sekolah
 * belum memakai absen aplikasi, gangguan): notifikasi ke siswa DITAHAN — push yang sudah terkirim tidak bisa
 * ditarik. Admin tetap mendapat rekap dengan kalimat penahanan.
 */
export const holdAlphaNotices = (c: { readonly checkins: number; readonly alpha: number }): boolean => c.checkins === 0 && c.alpha > 0;
