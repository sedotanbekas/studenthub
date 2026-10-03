import type { DayCounts } from "@/lib/attendance/day-notice-rules";
import type { NotificationEvent } from "@/lib/notifications/notify";
import { resolveCategory } from "@/lib/notifications/rules";
import { attendanceAlphaNotification, attendanceDaySummaryNotification } from "@/lib/notifications/templates/attendance-day";
import { addDays, type LocalDate } from "@/lib/time/zone";
import type { Row } from "./types";

/**
 * Notifikasi absensi contoh per persona (N4), dibuat dengan template server sehingga teksnya identik: Alya (s1)
 * mendapat Alpa hari sekolah demo sebelumnya (tombol ajukan izin aktif), admin sekolah mendapat rekap harian.
 * Persona lain tidak mendapat notifikasi absensi; tidak pernah ada nama siswa lain di kotak masuk siswa.
 */
export interface DemoNoticeViewer {
  readonly studentId?: string;
  readonly identity?: { readonly user: { readonly role: string } };
}

/** Siswa demo yang tercatat Alpa kemarin. */
export const DEMO_ALPHA_STUDENT_ID = "s1";
/** Angka rekap = ringkasan hari ini di dashboard demo (demoSummary.attendanceToday). */
export const DEMO_DAY_COUNTS: DayCounts = { alpha: 8, late: 24, izin: 18, sakit: 12, pendingAnomalies: 3 };

/** Hari sekolah demo sebelumnya: Minggu bukan hari sekolah (sama dengan peta demo). */
export function previousDemoSchoolDay(today: LocalDate): LocalDate {
  let date = addDays(today, -1);
  while (new Date(`${date}T00:00:00Z`).getUTCDay() === 0) date = addDays(date, -1);
  return date;
}

/** Bentuk InboxItem: dibuat saat hari ditutup (15:05 WIB). */
function inboxRow(id: string, event: NotificationEvent, date: LocalDate): Row {
  return { id, type: event.type, category: resolveCategory(event.type), title: event.title, body: event.body, data: event.link ?? null, announcementId: null, readAt: null, createdAt: `${date}T08:05:00.000Z` };
}

export function demoAttendanceNotices(viewer: DemoNoticeViewer | undefined, today: LocalDate): Row[] {
  const date = previousDemoSchoolDay(today);
  if (viewer?.studentId === DEMO_ALPHA_STUDENT_ID) return [inboxRow("demo-alpha", attendanceAlphaNotification({ date }), date)];
  if (viewer?.identity?.user.role === "SCHOOL_ADMIN") {
    return [inboxRow("demo-day-summary", attendanceDaySummaryNotification({ date, counts: DEMO_DAY_COUNTS, alphaHeld: false }), date)];
  }
  return [];
}
