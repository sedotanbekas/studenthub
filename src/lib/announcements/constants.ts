import type { AnnouncementAudience, AnnouncementStatus, NotificationCategory } from "@prisma/client";

/** Konstanta domain pengumuman (desain 05 bagian A; PLAN: tanpa penjadwalan & tanpa edit setelah terbit). */

export const ANNOUNCEMENT_TITLE_MIN = 3;
export const ANNOUNCEMENT_TITLE_MAX = 150;
export const ANNOUNCEMENT_BODY_MIN = 1;
export const ANNOUNCEMENT_BODY_MAX = 5000;
export const MAX_CLASS_TARGETS = 50;
export const MAX_STUDENT_TARGETS = 500;
export const CANCEL_REASON_MAX = 255;
export const SEARCH_QUERY_MAX = 100;

/** Kategori yang boleh dipakai admin sekolah (SYSTEM khusus notifikasi platform). */
export const ANNOUNCEMENT_CATEGORIES = ["ACADEMIC", "FINANCE", "EVENT", "CALENDAR", "STUDENT_AFFAIRS"] as const satisfies readonly NotificationCategory[];
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_AUDIENCES = ["ALL", "CLASSES", "STUDENTS"] as const satisfies readonly AnnouncementAudience[];
export const ANNOUNCEMENT_STATUSES = ["DRAFT", "PUBLISHED", "CANCELLED"] as const satisfies readonly AnnouncementStatus[];

/** Deep link notifikasi pengumuman di app siswa. */
export const ANNOUNCEMENT_LINK_SCREEN = "announcement";

/** Entitas & aksi audit. */
export const AUDIT_ENTITY = "Announcement";
