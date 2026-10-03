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
  ATTENDANCE_ALPHA: "ATTENDANCE",
  ATTENDANCE_DAY_SUMMARY: "ATTENDANCE",
};

export const NOTIFICATION_PREVIEW_MAX = 500;
export const NOTIFICATION_TITLE_MAX = 150;
/** Panjang kolom Notification.dedupKey. Kunci lebih panjang DITOLAK (INSERT IGNORE akan memotongnya diam-diam). */
export const NOTIFICATION_DEDUP_KEY_MAX = 64;

export function assertDedupKey(key: string | undefined): void {
  if (key !== undefined && (key.length === 0 || key.length > NOTIFICATION_DEDUP_KEY_MAX)) {
    throw new RangeError(`dedupKey notifikasi harus 1..${NOTIFICATION_DEDUP_KEY_MAX} karakter: ${key.slice(0, 80)}`);
  }
}

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

// ----------------------------------------------------------------------------- mute kategori siaran admin (N2)

/**
 * Tipe notifikasi yang disiarkan ke SEMUA admin sekolah (notifySchoolAdmins hanya menerima tipe ini — dicek tsc).
 * Menambah siaran admin baru = tambahkan di sini, lalu putuskan apakah kategorinya boleh dimatikan.
 */
export const SCHOOL_ADMIN_BROADCAST_TYPES = [
  "PAYMENT_SUBMITTED",
  "LEAVE_SUBMITTED",
  "SCHOOL_SETTINGS_CHANGED",
  "NISN_RELEASED",
  "ATTENDANCE_DAY_SUMMARY",
] as const satisfies readonly NotificationType[];
export type SchoolAdminBroadcastType = (typeof SCHOOL_ADMIN_BROADCAST_TYPES)[number];

/**
 * Kategori siaran admin sekolah yang boleh dimatikan per akun (urutan = urutan tampilan) = kategori tipe siaran di
 * atas selain SYSTEM (dijaga test). SYSTEM (pengaturan/rekening sekolah, NISN dilepas) tidak pernah.
 */
export const ADMIN_MUTABLE_CATEGORIES = ["FINANCE", "STUDENT_AFFAIRS", "ATTENDANCE"] as const satisfies readonly NotificationCategory[];
export type AdminMutableCategory = (typeof ADMIN_MUTABLE_CATEGORIES)[number];

export const isAdminMutableCategory = (category: NotificationCategory): category is AdminMutableCategory =>
  (ADMIN_MUTABLE_CATEGORIES as readonly NotificationCategory[]).includes(category);

/** Buang duplikat & kategori yang tidak bisa dimatikan; urut sesuai ADMIN_MUTABLE_CATEGORIES. */
export function normalizeMutedCategories(input: readonly NotificationCategory[]): AdminMutableCategory[] {
  return ADMIN_MUTABLE_CATEGORIES.filter((category) => input.includes(category));
}

/** Perubahan set tersimpan -> set baru (removed boleh memuat kategori lama yang tak lagi bisa dimatikan). */
export function diffMutedCategories(stored: readonly NotificationCategory[], next: readonly AdminMutableCategory[]): { added: AdminMutableCategory[]; removed: NotificationCategory[] } {
  return { added: next.filter((c) => !stored.includes(c)), removed: [...new Set(stored)].filter((c) => !(next as readonly NotificationCategory[]).includes(c)) };
}

export interface BroadcastCandidate {
  readonly userId: string;
  readonly isPrimary: boolean;
  /** Pernah masuk & kata sandi sementara belum kedaluwarsa (isReachableAdmin). */
  readonly reachable: boolean;
  readonly muted: readonly NotificationCategory[];
}

/** Akun yang belum pernah masuk / kata sandi sementaranya kedaluwarsa tidak dihitung sebagai penangan kabar. */
export function isReachableAdmin(user: { lastLoginAt: Date | null; mustChangePassword: boolean; tempPasswordExpiresAt: Date | null }, now: Date): boolean {
  if (user.lastLoginAt === null) return false;
  return !(user.mustChangePassword && user.tempPasswordExpiresAt !== null && user.tempPasswordExpiresAt <= now);
}

/**
 * Penerima siaran admin: kategori tak bisa dimatikan -> semua. Selain itu buang yang mematikan; bila tidak ada
 * penerima tersisa yang bisa dijangkau -> admin utama ikut menerima (atau semua kandidat bila admin utama tidak ada),
 * agar pekerjaan tidak pernah sunyi. Urutan kandidat dijaga.
 */
export function selectBroadcastRecipients(candidates: readonly BroadcastCandidate[], category: NotificationCategory): string[] {
  if (!isAdminMutableCategory(category)) return candidates.map((c) => c.userId);
  const keep = candidates.filter((c) => !c.muted.includes(category));
  if (keep.some((c) => c.reachable)) return keep.map((c) => c.userId);
  const primary = candidates.find((c) => c.isPrimary);
  if (!primary) return candidates.map((c) => c.userId);
  return candidates.filter((c) => c === primary || keep.includes(c)).map((c) => c.userId);
}
