import type { NotificationCategory, NotificationType, PushStatus, UserRole } from "@prisma/client";

/** Kategori ikon per tipe notifikasi; "FROM_EVENT" = memakai kategori pengumuman. Total (dicek tsc). */
export const CATEGORY_BY_TYPE: Readonly<Record<NotificationType, NotificationCategory | "FROM_EVENT">> = {
  ANNOUNCEMENT: "FROM_EVENT",
  INVOICE_ISSUED: "FINANCE",
  PAYMENT_SUBMITTED: "FINANCE",
  PAYMENT_APPROVED: "FINANCE",
  PAYMENT_REJECTED: "FINANCE",
  LEAVE_SUBMITTED: "STUDENT_AFFAIRS",
  LEAVE_APPROVED: "STUDENT_AFFAIRS",
  LEAVE_REJECTED: "STUDENT_AFFAIRS",
  REPORT_CARD_PUBLISHED: "ACADEMIC",
  SPONSOR_APPROVED: "SYSTEM",
  SPONSOR_SUSPENDED: "SYSTEM",
  AD_SUBMITTED: "SYSTEM",
  AD_APPROVED: "SYSTEM",
  AD_REJECTED: "SYSTEM",
  TOPUP_SUBMITTED: "SYSTEM",
  TOPUP_APPROVED: "SYSTEM",
  TOPUP_REJECTED: "SYSTEM",
  LOW_BALANCE: "SYSTEM",
  ATTENDANCE_CORRECTED: "STUDENT_AFFAIRS",
  INVOICE_VOIDED: "FINANCE",
  PAYMENT_VOIDED: "FINANCE",
  NISN_RELEASED: "SYSTEM",
  SCHOOL_SETTINGS_CHANGED: "SYSTEM",
};

export const NOTIFICATION_PREVIEW_MAX = 500;
export const NOTIFICATION_TITLE_MAX = 150;

export function resolveCategory(type: NotificationType, explicit?: NotificationCategory): NotificationCategory {
  const mapped = CATEGORY_BY_TYPE[type];
  if (mapped !== "FROM_EVENT") return mapped;
  if (!explicit) throw new Error(`Kategori wajib untuk notifikasi ${type}`);
  return explicit;
}

/** Push hanya untuk siswa (app mobile); peran lain memantau inbox lewat polling. */
export function initialPushStatus(role: UserRole): PushStatus {
  return role === "STUDENT" ? "PENDING" : "SKIPPED";
}

/** Pratinjau teks polos: rapikan spasi, potong di batas kata tanpa memecah emoji. */
export function previewText(body: string, max: number = NOTIFICATION_PREVIEW_MAX): string {
  const clean = body.replace(/\s+/g, " ").trim();
  const chars = Array.from(clean);
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max - 1).join("");
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > max * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`;
}
