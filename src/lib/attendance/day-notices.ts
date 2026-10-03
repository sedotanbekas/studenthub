import type { Tx } from "@/lib/db";
import { notifyRecipients, notifySchoolAdmins, type NotifyContext } from "@/lib/notifications/notify";
import { attendanceAlphaNotification, attendanceAlphaPendingNotification, attendanceDaySummaryNotification } from "@/lib/notifications/templates/attendance-day";
import { fromDbDate, localParts, toDbDate, type LocalDate, type SchoolTz } from "@/lib/time/zone";
import { PENDING_ANOMALY_REVIEW_WHERE } from "./anomaly-review-rules";
import { chunk } from "./auto-alpha-rules";
import {
  ALPHA_NOTICE_MAX_AGE_DAYS,
  DAY_SUMMARY_MAX_AGE_DAYS,
  alphaNoticeKey,
  dayCountsFrom,
  daySummaryKey,
  holdAlphaNotices,
  isFreshClose,
  isNotableDay,
  planAlphaNotices,
} from "./day-notice-rules";

/**
 * Notifikasi saat hari sekolah ditutup (N4, keputusan pemilik 2026-10-03). Selalu berjalan DI DALAM transaksi
 * penutup (closeDayLocked) yang sudah memegang kunci kalender, setelah baris Attendance ditulis — Notification
 * ditulis terakhir. Idempoten lewat dedupKey (unik per penerima, INSERT IGNORE): tick ulang, ambil-alih RUNNING basi,
 * tutup-ulang super admin, dan sinkronisasi kalender menghasilkan paling banyak satu baris per penerima per tanggal.
 */
const ID_CHUNK = 500;

export interface NoticeSchool {
  readonly id: string;
  readonly timezone: SchoolTz;
}

export interface DayNoticeResult {
  readonly students: number;
  readonly admins: number;
  /** Notifikasi Alpa ke siswa ditahan karena tidak ada satu pun check-in. */
  readonly held: boolean;
}

export async function notifyDayClosed(tx: Tx, school: NoticeSchool, date: LocalDate, alphaDraftIds: readonly string[], now: Date): Promise<DayNoticeResult> {
  const today = localParts(now, school.timezone).ymd;
  const studentsFresh = alphaDraftIds.length > 0 && isFreshClose(date, today, ALPHA_NOTICE_MAX_AGE_DAYS);
  const adminsFresh = isFreshClose(date, today, DAY_SUMMARY_MAX_AGE_DAYS);
  if (!studentsFresh && !adminsFresh) return { students: 0, admins: 0, held: false };
  const checkins = await tx.attendance.count({ where: { schoolId: school.id, date: toDbDate(date), checkInAt: { not: null } } });
  const held = studentsFresh && holdAlphaNotices({ checkins, alpha: alphaDraftIds.length });
  const students = studentsFresh && !held ? await notifyAlphaStudents(tx, school.id, date, alphaDraftIds, { now }) : 0;
  const admins = adminsFresh ? await notifyDaySummary(tx, school.id, date, checkins, { now }) : 0;
  return { students, admins, held };
}

/**
 * Baca ulang draf yang benar-benar menjadi AUTO_ALPHA (baris check-in/izin/koreksi yang menang INSERT IGNORE
 * terbuang) dan hanya untuk akun aktif yang pernah masuk. Penutup bersamaan diredam dedupKey, bukan kueri ini.
 */
async function notifyAlphaStudents(tx: Tx, schoolId: string, date: LocalDate, alphaDraftIds: readonly string[], ctx: NotifyContext): Promise<number> {
  const day = toDbDate(date);
  const userOf = new Map<string, string>();
  for (const part of chunk([...new Set(alphaDraftIds)].sort(), ID_CHUNK)) {
    const rows = await tx.attendance.findMany({
      where: { schoolId, date: day, source: "AUTO_ALPHA", studentId: { in: part }, student: { user: { isActive: true, lastLoginAt: { not: null } } } },
      select: { studentId: true, student: { select: { userId: true } } },
    });
    for (const row of rows) userOf.set(row.studentId, row.student.userId);
  }
  if (userOf.size === 0) return 0;
  const pending = await tx.leaveRequest.findMany({
    where: { schoolId, status: "PENDING", startDate: { lte: day }, endDate: { gte: day } },
    select: { id: true, studentId: true, type: true, startDate: true, endDate: true },
  });
  const plan = planAlphaNotices(date, [...userOf.keys()], pending.map((l) => ({ ...l, startDate: fromDbDate(l.startDate), endDate: fromDbDate(l.endDate) })));
  const recipients = (ids: readonly string[]) => ids.flatMap((id) => (userOf.has(id) ? [{ userId: userOf.get(id) as string, role: "STUDENT" as const }] : []));
  let sent = await notifyRecipients(tx, recipients(plan.plain), attendanceAlphaNotification({ date }), ctx);
  for (const notice of plan.pending) {
    sent += await notifyRecipients(tx, recipients([notice.studentId]), attendanceAlphaPendingNotification({ date, leaveId: notice.leaveId, type: notice.type }), ctx);
  }
  return sent;
}

/** Rekap satu sekolah per hari ke admin (lewat saringan kategori N2); hari tanpa tindak lanjut dilewati. */
async function notifyDaySummary(tx: Tx, schoolId: string, date: LocalDate, checkins: number, ctx: NotifyContext): Promise<number> {
  const day = toDbDate(date);
  const groups = await tx.attendance.groupBy({ by: ["status"], where: { schoolId, date: day }, _count: { _all: true } });
  const pendingAnomalies = await tx.attendance.count({ where: { schoolId, date: day, ...PENDING_ANOMALY_REVIEW_WHERE } });
  const counts = dayCountsFrom(groups.map((g) => ({ status: g.status, count: g._count._all })), pendingAnomalies);
  if (!isNotableDay(counts)) return 0;
  const event = attendanceDaySummaryNotification({ date, counts, alphaHeld: holdAlphaNotices({ checkins, alpha: counts.alpha }) });
  return notifySchoolAdmins(tx, schoolId, event, ctx);
}

/**
 * Tarik notifikasi tanggal yang kini libur (sinkronisasi kalender, satu potongan sekolah): Alpa milik siswa yang
 * baris turunannya (AUTO_ALPHA atau LEAVE — varian "pengajuan belum disetujui" bisa sudah menjadi LEAVE) dihapus,
 * dan rekap harian SEMUA admin sekolah di potongan itu untuk tanggal-tanggal tersebut. Lewat indeks unik
 * (userId, dedupKey). Push yang sudah terkirim tidak bisa ditarik — karena itu Alpa massal ditahan saat ditutup.
 */
export async function retractDayNotices(tx: Tx, schoolIds: readonly string[], studentIds: readonly string[], dates: readonly LocalDate[]): Promise<number> {
  if (dates.length === 0 || schoolIds.length === 0) return 0;
  let retracted = 0;
  for (const part of chunk([...new Set(studentIds)].sort(), ID_CHUNK)) {
    const students = await tx.student.findMany({ where: { id: { in: part } }, select: { userId: true } });
    if (students.length === 0) continue;
    const where = { type: "ATTENDANCE_ALPHA" as const, userId: { in: students.map((s) => s.userId) }, dedupKey: { in: dates.map(alphaNoticeKey) } };
    retracted += (await tx.notification.deleteMany({ where })).count;
  }
  const admins = await tx.user.findMany({ where: { schoolId: { in: [...schoolIds] }, role: "SCHOOL_ADMIN" }, select: { id: true } });
  for (const part of chunk(admins.map((a) => a.id), ID_CHUNK)) {
    const where = { type: "ATTENDANCE_DAY_SUMMARY" as const, userId: { in: part }, dedupKey: { in: dates.map(daySummaryKey) } };
    retracted += (await tx.notification.deleteMany({ where })).count;
  }
  return retracted;
}
