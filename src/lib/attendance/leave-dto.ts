import type { Prisma } from "@prisma/client";
import { fromDbDate } from "@/lib/time/zone";
import type { LeaveRequestDto, SchoolLeaveDto } from "./leave-schemas";

/** Pemetaan baris LeaveRequest -> DTO (tanggal @db.Date -> "YYYY-MM-DD", instant -> ISO). */
export const LEAVE_SELECT = {
  id: true,
  type: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  attachmentFileId: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
} as const satisfies Prisma.LeaveRequestSelect;

export const SCHOOL_LEAVE_SELECT = {
  ...LEAVE_SELECT,
  student: { select: { id: true, nis: true, user: { select: { name: true } }, currentClass: { select: { name: true } } } },
} as const satisfies Prisma.LeaveRequestSelect;

export type LeaveRow = Prisma.LeaveRequestGetPayload<{ select: typeof LEAVE_SELECT }>;
export type SchoolLeaveRow = Prisma.LeaveRequestGetPayload<{ select: typeof SCHOOL_LEAVE_SELECT }>;

/** Rentang lokal sebuah baris (untuk hitung hari sekolah). */
export function rangeOf(row: Pick<LeaveRow, "startDate" | "endDate">): { startDate: string; endDate: string } {
  return { startDate: fromDbDate(row.startDate), endDate: fromDbDate(row.endDate) };
}

export function toLeaveDto(row: LeaveRow, schoolDayCount: number): LeaveRequestDto {
  return {
    id: row.id,
    type: row.type,
    ...rangeOf(row),
    schoolDayCount,
    reason: row.reason,
    status: row.status,
    attachmentFileId: row.attachmentFileId,
    reviewNote: row.reviewNote,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toSchoolLeaveDto(row: SchoolLeaveRow, schoolDayCount: number): SchoolLeaveDto {
  const { student, ...leave } = row;
  return {
    ...toLeaveDto(leave, schoolDayCount),
    student: { id: student.id, name: student.user.name, nis: student.nis, className: student.currentClass?.name ?? null },
  };
}
