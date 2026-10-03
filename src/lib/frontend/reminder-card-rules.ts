import { reminderSendMinute, reminderSlot, REMINDER_LEAD_MAX, REMINDER_LEAD_MIN } from "@/lib/attendance/reminder-rules";
import type { SchoolTz } from "@/lib/time/zone";
import { clockText, number } from "./format";

/** Teks kartu "Pengingat absen" di Pengaturan sekolah (N5): pratinjau langsung, jangkauan, toast tersimpan. */

export interface ReminderSettingsView {
  readonly enabled: boolean;
  readonly leadMinutes: number;
  readonly checkInOpenMinute: number;
  readonly startMinute: number;
  readonly lateToleranceMinutes: number;
  readonly schoolDaysMask: number;
  readonly timezone: SchoolTz;
  readonly defaultSchedule: boolean;
  readonly activeStudentCount: number;
  readonly pushReadyStudentCount: number;
}

export const isValidLead = (lead: number): boolean => Number.isInteger(lead) && lead >= REMINDER_LEAD_MIN && lead <= REMINDER_LEAD_MAX;

const sendMinuteOf = (v: Pick<ReminderSettingsView, "checkInOpenMinute" | "startMinute" | "leadMinutes">): number =>
  reminderSendMinute({ checkInOpenMinute: v.checkInOpenMinute, startMinute: v.startMinute, attendanceReminderLeadMinutes: v.leadMinutes });

/** Baris pratinjau (berubah langsung saat menit diketik). */
export function reminderPreview(v: ReminderSettingsView): string[] {
  if (!v.enabled) return ["Mati — siswa tidak menerima pengingat absen."];
  if (v.defaultSchedule) return ["Belum dikirim: jam sekolah masih bawaan (07:00). Atur jam & hari absensi dulu agar pengingat menyebut jam masuk yang benar."];
  if (!isValidLead(v.leadMinutes)) return [`Isi ${REMINDER_LEAD_MIN}–${REMINDER_LEAD_MAX} menit.`];
  const send = sendMinuteOf(v);
  const lines = [`Siswa yang belum absen menerima notifikasi HP pukul ${clockText(send)} — ${v.startMinute - send} menit sebelum jam masuk ${clockText(v.startMinute)}.`];
  if (send === v.checkInOpenMinute && v.startMinute - v.leadMinutes < v.checkInOpenMinute) lines.push(`Jam buka absen ${clockText(v.checkInOpenMinute)}, jadi pengingat dikirim saat absen dibuka.`);
  return lines;
}

export function reachText(v: Pick<ReminderSettingsView, "activeStudentCount" | "pushReadyStudentCount">): string {
  return `${number(v.pushReadyStudentCount)} dari ${number(v.activeStudentCount)} siswa aktif bisa menerima notifikasi HP. Siswa iPhone harus menambahkan studenthub.id ke Layar Utama dan mengizinkan notifikasi.`;
}

/** Toast setelah simpan: "segera dikirim" bila jendela hari ini sedang terbuka (tick berikutnya langsung mengirim). */
export function savedText(v: ReminderSettingsView, now: Date): string {
  if (!v.enabled) return "Tersimpan — pengingat absen dimatikan.";
  if (v.defaultSchedule) return "Tersimpan — pengingat mulai dikirim setelah jam sekolah diatur.";
  const slot = reminderSlot(now, { timezone: v.timezone, checkInOpenMinute: v.checkInOpenMinute, startMinute: v.startMinute, lateToleranceMinutes: v.lateToleranceMinutes, schoolDaysMask: v.schoolDaysMask, attendanceReminderLeadMinutes: v.leadMinutes });
  return slot ? "Tersimpan — pengingat hari ini segera dikirim." : `Tersimpan — pengingat berikutnya pukul ${clockText(sendMinuteOf(v))}.`;
}
