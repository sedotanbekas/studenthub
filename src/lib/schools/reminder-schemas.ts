import { z } from "zod";
import { REMINDER_LEAD_MAX, REMINDER_LEAD_MIN } from "@/lib/attendance/reminder-rules";

/** Skema pengaturan pengingat absen sekolah (N5): GET/PUT /school/settings/attendance-reminder. */

export const updateAttendanceReminderBody = z.strictObject({
  enabled: z.boolean({ error: "enabled harus true atau false." }),
  leadMinutes: z
    .int({ error: "leadMinutes harus bilangan bulat." })
    .min(REMINDER_LEAD_MIN, `Pengingat paling cepat ${REMINDER_LEAD_MIN} menit sebelum jam masuk.`)
    .max(REMINDER_LEAD_MAX, `Pengingat paling lambat ${REMINDER_LEAD_MAX} menit sebelum jam masuk.`)
    .meta({ description: "Menit sebelum jam masuk (5..120); tidak pernah lebih awal dari jam buka absen." }),
});
export type UpdateAttendanceReminderBody = z.output<typeof updateAttendanceReminderBody>;

const minute = (description: string) => z.int().min(0).max(1439).meta({ description });

export const attendanceReminderSettingsSchema = z
  .object({
    enabled: z.boolean(),
    leadMinutes: z.int(),
    checkInOpenMinute: minute("Jam buka absen (menit lokal)."),
    startMinute: minute("Jam masuk (menit lokal)."),
    lateToleranceMinutes: z.int().meta({ description: "Toleransi terlambat; pengingat kedaluwarsa di jam masuk + toleransi." }),
    schoolDaysMask: z.int(),
    sendMinute: minute("Menit lokal pengingat dikirim = max(jam masuk - lead, jam buka absen)."),
    timezone: z.enum(["WIB", "WITA", "WIT"]),
    defaultSchedule: z.boolean().meta({ description: "true = jam & hari absensi masih bawaan: pengingat tidak dikirim sampai jadwal diatur." }),
    activeStudentCount: z.int().min(0),
    pushReadyStudentCount: z.int().min(0).meta({ description: "Siswa aktif yang punya perangkat penerima notifikasi HP (Web Push / app)." }),
  })
  .meta({ id: "AttendanceReminderSettings" });
export type AttendanceReminderSettingsDto = z.input<typeof attendanceReminderSettingsSchema>;
