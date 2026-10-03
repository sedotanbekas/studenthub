import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { isDefaultSchedule, reminderSendMinute } from "@/lib/attendance/reminder-rules";
import { prisma, type Prisma } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { loadReachableDevices } from "@/lib/push/delivery";
import { chunk } from "@/lib/push/rules";
import type { SchoolScope } from "@/lib/tenant/scope";
import { lockKey, withTx } from "@/lib/tx";
import { SCHOOL_NOT_FOUND_MESSAGE } from "./queries";
import type { AttendanceReminderSettingsDto, UpdateAttendanceReminderBody } from "./reminder-schemas";
import { schoolConfigLockKey } from "./service";

/**
 * Pengaturan pengingat absen sekolah (N5): GET/PUT /school/settings/attendance-reminder. School adalah tenant itu
 * sendiri (resolveSchoolScope; id tak dikenal -> 404). PUT di bawah kunci pengaturan sekolah yang sama dengan
 * jadwal; nilai sama -> tanpa tulis & tanpa audit; selain itu audit `school.attendance_reminder_update`.
 */
const REMINDER_SETTINGS_SELECT = {
  timezone: true, checkInOpenMinute: true, startMinute: true, lateToleranceMinutes: true, checkInCloseMinute: true, dayEndMinute: true,
  schoolDaysMask: true, attendanceReminderEnabled: true, attendanceReminderLeadMinutes: true,
} as const satisfies Prisma.SchoolSelect;
type ReminderSettingsRow = Prisma.SchoolGetPayload<{ select: typeof REMINDER_SETTINGS_SELECT }>;

const REACH_CHUNK = 1_000;

/** Siswa aktif & berapa yang punya perangkat penerima push (definisi dispatcher: Expo + Web Push bila aktif). */
async function reachOf(schoolId: string, now: Date): Promise<{ active: number; ready: number }> {
  const students = await prisma.student.findMany({ where: { schoolId, status: "ACTIVE", user: { isActive: true } }, select: { userId: true } });
  let ready = 0;
  for (const part of chunk(students.map((s) => s.userId), REACH_CHUNK)) ready += (await loadReachableDevices(part, now)).size;
  return { active: students.length, ready };
}

function toDto(row: ReminderSettingsRow, reach: { active: number; ready: number }): AttendanceReminderSettingsDto {
  return {
    enabled: row.attendanceReminderEnabled,
    leadMinutes: row.attendanceReminderLeadMinutes,
    checkInOpenMinute: row.checkInOpenMinute,
    startMinute: row.startMinute,
    lateToleranceMinutes: row.lateToleranceMinutes,
    schoolDaysMask: row.schoolDaysMask,
    sendMinute: reminderSendMinute(row),
    timezone: row.timezone,
    defaultSchedule: isDefaultSchedule(row),
    activeStudentCount: reach.active,
    pushReadyStudentCount: reach.ready,
  };
}

export async function getAttendanceReminderSettings(scope: SchoolScope, ctx: ActionContext): Promise<AttendanceReminderSettingsDto> {
  const row = await prisma.school.findUnique({ where: { id: scope.schoolId }, select: REMINDER_SETTINGS_SELECT });
  if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
  return toDto(row, await reachOf(scope.schoolId, ctx.now));
}

export async function updateAttendanceReminderSettings(scope: SchoolScope, input: UpdateAttendanceReminderBody, ctx: ActionContext): Promise<AttendanceReminderSettingsDto> {
  const schoolId = scope.schoolId;
  await withTx(async (tx) => {
    await lockKey(tx, schoolConfigLockKey(schoolId));
    const row = await tx.school.findUnique({ where: { id: schoolId }, select: REMINDER_SETTINGS_SELECT });
    if (!row) throw notFound(SCHOOL_NOT_FOUND_MESSAGE);
    const before = { enabled: row.attendanceReminderEnabled, leadMinutes: row.attendanceReminderLeadMinutes };
    if (before.enabled === input.enabled && before.leadMinutes === input.leadMinutes) return;
    await tx.school.update({ where: { id: schoolId }, data: { attendanceReminderEnabled: input.enabled, attendanceReminderLeadMinutes: input.leadMinutes } });
    await writeAudit(tx, { action: "school.attendance_reminder_update", entityType: "School", entityId: schoolId, schoolId, before, after: { ...input } }, ctx);
  });
  return getAttendanceReminderSettings(scope, ctx);
}
