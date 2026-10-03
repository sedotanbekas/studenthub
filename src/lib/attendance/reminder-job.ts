import type { JobContext } from "@/lib/auth/principal";
import { loadCalendarContext } from "@/lib/calendar/queries";
import { checkSchoolDay } from "@/lib/calendar/rules";
import { prisma, type Prisma, type Tx } from "@/lib/db";
import { runKeyedJob } from "@/lib/jobs/runner";
import { schoolScopeFilter } from "@/lib/jobs/scope";
import type { JobOutcome, JobResult } from "@/lib/jobs/types";
import { notifyRecipients } from "@/lib/notifications/notify";
import { attendanceReminderEvent } from "@/lib/notifications/templates/attendance-reminder";
import { loadReachableDevices } from "@/lib/push/delivery";
import { kickPushDispatch } from "@/lib/push/kick";
import { fromDbDate, toDbDate, type LocalDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { eligibilityCutoff, isSettledRun } from "./auto-alpha-rules";
import { sweepCheckedInReminders } from "./reminder-expiry";
import { ATTENDANCE_REMINDER_JOB, isDefaultSchedule, planReminderRecipients, reminderSlot } from "./reminder-rules";
import { hasTimeLeft } from "./retention";

/**
 * Job "attendance-reminder" (N5, keputusan pemilik 2026-10-03; tipe antrean, tiap tick). Sekolah aktif dengan pengingat
 * menyala dan jadwal yang SUDAH diatur (bukan bawaan) yang sedang di jendela kirim -> runKeyedJob(pengingat, sekolah,
 * tanggal lokal) TEPAT SEKALI: hari sekolah sungguhan (kalender, BUKAN mode uji) -> siswa wajib absen yang belum punya
 * baris, tanpa izin PENDING/DISETUJUI, dan punya perangkat push -> satu notifikasi push-only (dedupKey per tanggal).
 * Jendela terlewat = tidak dikirim susulan.
 */
export const REMINDER_SCHOOL_SELECT = {
  id: true, timezone: true, checkInOpenMinute: true, startMinute: true, lateToleranceMinutes: true, checkInCloseMinute: true,
  dayEndMinute: true, schoolDaysMask: true, attendanceReminderLeadMinutes: true,
} as const satisfies Prisma.SchoolSelect;
export type ReminderSchool = Prisma.SchoolGetPayload<{ select: typeof REMINDER_SCHOOL_SELECT }>;
export type ReminderSlot = NonNullable<ReturnType<typeof reminderSlot>>;

const REMINDER_TX_TIMEOUT_MS = 30_000;

async function settledKeys(due: readonly { school: ReminderSchool; slot: ReminderSlot }[]): Promise<ReadonlySet<string>> {
  if (due.length === 0) return new Set();
  const runs = await prisma.jobRun.findMany({
    where: { job: ATTENDANCE_REMINDER_JOB, scopeKey: { in: due.map((d) => d.school.id) }, runKey: { in: [...new Set(due.map((d) => d.slot.date))] } },
    select: { scopeKey: true, runKey: true, status: true, attempts: true },
  });
  return new Set(runs.filter(isSettledRun).map((run) => `${run.scopeKey}|${run.runKey}`));
}

export async function runAttendanceReminders(ctx: JobContext): Promise<JobResult> {
  const schools = await prisma.school.findMany({ where: { isActive: true, attendanceReminderEnabled: true, ...schoolScopeFilter(ctx) }, select: REMINDER_SCHOOL_SELECT, orderBy: { id: "asc" } });
  const due = schools.flatMap((school) => {
    const slot = isDefaultSchedule(school) ? null : reminderSlot(ctx.now, school);
    return slot ? [{ school, slot }] : [];
  });
  const settled = await settledKeys(due);
  const counts: Record<JobOutcome, number> = { ran: 0, skipped: 0, failed: 0 };
  let hasMore = false;
  for (const { school, slot } of due.filter((d) => !settled.has(`${d.school.id}|${d.slot.date}`))) {
    if (!hasTimeLeft(ctx.deadline)) {
      hasMore = true;
      break;
    }
    counts[await runKeyedJob(ATTENDANCE_REMINDER_JOB, school.id, slot.date, () => sendSchoolReminders(school, slot, ctx), ctx)] += 1;
  }
  return { schools: schools.length, due: due.length, ...counts, hasMore };
}

async function candidatesOf(tx: Tx, school: ReminderSchool, date: LocalDate) {
  const day = toDbDate(date);
  const [candidates, leaves] = await Promise.all([
    tx.student.findMany({
      where: { schoolId: school.id, status: "ACTIVE", activatedAt: { lt: eligibilityCutoff(date, school) }, attendances: { none: { date: day } }, user: { isActive: true } },
      select: { id: true, userId: true, status: true, activatedAt: true },
    }),
    tx.leaveRequest.findMany({
      where: { schoolId: school.id, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: day }, endDate: { gte: day } },
      select: { studentId: true, startDate: true, endDate: true },
    }),
  ]);
  return { candidates, leaves: leaves.map((l) => ({ studentId: l.studentId, startDate: fromDbDate(l.startDate), endDate: fromDbDate(l.endDate) })) };
}

/** Satu sekolah satu tanggal (fn runKeyedJob). Hasil disimpan di JobRun.result. */
export async function sendSchoolReminders(school: ReminderSchool, slot: ReminderSlot, ctx: Pick<JobContext, "now">): Promise<JobResult> {
  const result = await withTx(async (tx) => {
    const day = checkSchoolDay(slot.date, await loadCalendarContext(tx, school, { from: slot.date, to: slot.date }));
    if (!day.isSchoolDay) return { date: slot.date, skipped: "NON_SCHOOL_DAY", reason: day.reason };
    const { candidates, leaves } = await candidatesOf(tx, school, slot.date);
    const reachable = new Set((await loadReachableDevices(candidates.map((c) => c.userId), ctx.now)).keys());
    const recipients = planReminderRecipients(slot.date, candidates, leaves, school, reachable);
    const event = attendanceReminderEvent({ date: slot.date, startMinute: school.startMinute, lateToleranceMinutes: school.lateToleranceMinutes, expiresAt: slot.expiresAt });
    const created = await notifyRecipients(tx, recipients.map((userId) => ({ userId, role: "STUDENT" as const })), event, { now: ctx.now });
    const obsolete = await sweepCheckedInReminders(tx, school.id, slot.date, recipients);
    return { date: slot.date, candidates: candidates.length, unreachable: candidates.filter((c) => !reachable.has(c.userId)).length, recipients: recipients.length, created, obsolete };
  }, { timeout: REMINDER_TX_TIMEOUT_MS });
  // Baris baru langsung dikirim (bukan menunggu tick berikutnya): jendela berakhir semenit sebelum bel.
  if ((result.created ?? 0) > 0) void kickPushDispatch();
  return result;
}
