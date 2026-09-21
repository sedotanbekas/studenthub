import type { AnnouncementAudience, AnnouncementStatus, NotificationCategory, Prisma } from "@prisma/client";
import type { AnnouncementDetailDto, AnnouncementListItemDto } from "./schemas";

/** Pemetaan baris Prisma -> DTO pengumuman (murni; instant sebagai ISO UTC). */

export const ANNOUNCEMENT_LIST_SELECT = {
  id: true,
  category: true,
  title: true,
  audience: true,
  status: true,
  publishedAt: true,
  cancelledAt: true,
  recipientCount: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true } },
} as const satisfies Prisma.AnnouncementSelect;

export const ANNOUNCEMENT_DETAIL_SELECT = {
  ...ANNOUNCEMENT_LIST_SELECT,
  body: true,
  targets: {
    select: {
      classId: true,
      studentId: true,
      schoolClass: { select: { id: true, name: true } },
      student: { select: { id: true, nis: true, user: { select: { name: true } } } },
    },
  },
} as const satisfies Prisma.AnnouncementSelect;

export interface AnnouncementListRow {
  readonly id: string;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly audience: AnnouncementAudience;
  readonly status: AnnouncementStatus;
  readonly publishedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly recipientCount: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly author: { readonly id: string; readonly name: string };
}

export interface AnnouncementTargetRow {
  readonly classId: string | null;
  readonly studentId: string | null;
  readonly schoolClass: { readonly id: string; readonly name: string } | null;
  readonly student: { readonly id: string; readonly nis: string; readonly user: { readonly name: string } } | null;
}

export interface AnnouncementDetailRow extends AnnouncementListRow {
  readonly body: string;
  readonly targets: readonly AnnouncementTargetRow[];
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);
const byName = <T extends { readonly name: string }>(a: T, b: T): number => a.name.localeCompare(b.name, "id");

export function toAnnouncementListItemDto(row: AnnouncementListRow): AnnouncementListItemDto {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    audience: row.audience,
    status: row.status,
    publishedAt: iso(row.publishedAt),
    cancelledAt: iso(row.cancelledAt),
    recipientCount: row.recipientCount,
    author: { id: row.author.id, name: row.author.name },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTargetsDto(targets: readonly AnnouncementTargetRow[]): AnnouncementDetailDto["targets"] {
  const classes = targets.flatMap((t) => (t.schoolClass ? [{ id: t.schoolClass.id, name: t.schoolClass.name }] : []));
  const students = targets.flatMap((t) => (t.student ? [{ id: t.student.id, name: t.student.user.name, nis: t.student.nis }] : []));
  return { classes: classes.toSorted(byName), students: students.toSorted(byName) };
}

export function toAnnouncementDetailDto(row: AnnouncementDetailRow, readCount: number): AnnouncementDetailDto {
  return {
    ...toAnnouncementListItemDto(row),
    body: row.body,
    targets: toTargetsDto(row.targets),
    stats: { recipientCount: row.recipientCount ?? 0, readCount },
  };
}

/** Audiens tersimpan dari baris target (untuk resolusi penerima saat terbit). */
export function audienceOf(row: { readonly audience: AnnouncementAudience; readonly targets: readonly Pick<AnnouncementTargetRow, "classId" | "studentId">[] }) {
  return {
    audience: row.audience,
    classIds: row.targets.flatMap((t) => (t.classId ? [t.classId] : [])),
    studentIds: row.targets.flatMap((t) => (t.studentId ? [t.studentId] : [])),
  };
}
