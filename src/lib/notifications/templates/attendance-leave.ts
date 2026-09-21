import type { NotificationEvent } from "../notify";

/**
 * Teks notifikasi izin/sakit (murni, Bahasa Indonesia). Tautan deep link: { screen: "leave-request", id }.
 * Notifikasi ke admin tidak memuat alasan izin (bisa berisi data kesehatan); detail dibuka di dashboard.
 */
type LeaveKind = "IZIN" | "SAKIT";

const MONTHS = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember",
] as const;

const KIND_LOWER: Readonly<Record<LeaveKind, string>> = { IZIN: "izin", SAKIT: "sakit" };
const KIND_TITLE: Readonly<Record<LeaveKind, string>> = { IZIN: "Izin", SAKIT: "Sakit" };
const LINK_SCREEN = "leave-request";

interface DateParts {
  readonly day: number;
  readonly month: string;
  readonly year: string;
}

function partsOf(date: string): DateParts {
  const [year = "", month = "1", day = "1"] = date.split("-");
  return { day: Number(day), month: MONTHS[Number(month) - 1] ?? month, year };
}

/** "2026-09-21".."2026-09-23" -> "21–23 September 2026" (lintas bulan/tahun ditulis lengkap). */
export function formatLeaveRange(startDate: string, endDate: string): string {
  const a = partsOf(startDate);
  const b = partsOf(endDate);
  if (startDate === endDate) return `${a.day} ${a.month} ${a.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${b.month} ${b.year}`;
  if (a.year === b.year) return `${a.day} ${a.month} – ${b.day} ${b.month} ${b.year}`;
  return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
}

interface LeaveRef {
  readonly leaveId: string;
  readonly type: LeaveKind;
  readonly startDate: string;
  readonly endDate: string;
}

export interface LeaveSubmittedInfo extends LeaveRef {
  readonly studentName: string;
  readonly className: string | null;
}

export function leaveSubmittedNotification(info: LeaveSubmittedInfo): NotificationEvent {
  const who = info.className ? `${info.studentName} (${info.className})` : info.studentName;
  return {
    type: "LEAVE_SUBMITTED",
    title: `Pengajuan ${KIND_LOWER[info.type]} baru`,
    body: `${who} mengajukan ${KIND_LOWER[info.type]} ${formatLeaveRange(info.startDate, info.endDate)}. Menunggu persetujuan.`,
    link: { screen: LINK_SCREEN, id: info.leaveId },
  };
}

export interface LeaveApprovedInfo extends LeaveRef {
  readonly note: string | null;
  /** true = dicatat admin atas nama siswa (bukan persetujuan pengajuan siswa). */
  readonly enteredByAdmin: boolean;
}

export function leaveApprovedNotification(info: LeaveApprovedInfo): NotificationEvent {
  const range = formatLeaveRange(info.startDate, info.endDate);
  const main = info.enteredByAdmin
    ? `Sekolah mencatat ${KIND_LOWER[info.type]} Anda untuk ${range}.`
    : `Pengajuan ${KIND_LOWER[info.type]} Anda untuk ${range} telah disetujui.`;
  return {
    type: "LEAVE_APPROVED",
    title: info.enteredByAdmin ? `${KIND_TITLE[info.type]} dicatat sekolah` : `${KIND_TITLE[info.type]} disetujui`,
    body: info.note ? `${main} Catatan: ${info.note}` : main,
    link: { screen: LINK_SCREEN, id: info.leaveId },
  };
}

export interface LeaveRejectedInfo extends LeaveRef {
  readonly note: string;
}

export function leaveRejectedNotification(info: LeaveRejectedInfo): NotificationEvent {
  const range = formatLeaveRange(info.startDate, info.endDate);
  return {
    type: "LEAVE_REJECTED",
    title: `${KIND_TITLE[info.type]} ditolak`,
    body: `Pengajuan ${KIND_LOWER[info.type]} Anda untuk ${range} ditolak. Alasan: ${info.note}`,
    link: { screen: LINK_SCREEN, id: info.leaveId },
  };
}
