import type { AnnouncementAudience, AnnouncementStatus, NotificationCategory, Prisma } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, notFound, unprocessable } from "@/lib/http/errors";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { invalidTargetIds, recipientFilter, transitionViolation, type AnnouncementAction, type NormalizedAudience } from "./rules";

/**
 * Akses data pengumuman ber-cakupan sekolah: scope, kunci baris, validasi target, penerima.
 * Id milik sekolah lain selalu 404 (pesan sama dengan "tidak ada").
 */

export const announcementNotFound = () => notFound("Pengumuman tidak ditemukan.");
export const stateConflict = () => conflict("STATE_CONFLICT", "Status pengumuman berubah bersamaan. Muat ulang lalu coba lagi.");

/** Transisi tidak sah -> 409 (terbit/batal/hapus) atau 422 (ubah) sesuai transitionViolation. */
export function assertAction(row: { readonly status: AnnouncementStatus }, action: AnnouncementAction): void {
  const violation = transitionViolation(row.status, action);
  if (!violation) return;
  throw violation.status === 409 ? conflict(violation.code, violation.message) : unprocessable(violation.code, violation.message);
}

export function announcementScopeOf(ctx: ActionContext, schoolId: string | undefined): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), schoolId);
}

/** SUPER_ADMIN dapat menyebut schoolId sembarang -> 404 SCHOOL_NOT_FOUND bila tidak ada. */
export async function assertSchoolExists(db: Tx, scope: SchoolScope): Promise<void> {
  const school = await db.school.findUnique({ where: { id: scope.schoolId }, select: { id: true } });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
}

const LOCKED_SELECT = {
  id: true,
  schoolId: true,
  status: true,
  category: true,
  title: true,
  body: true,
  audience: true,
  recipientCount: true,
  targets: { select: { classId: true, studentId: true } },
} as const satisfies Prisma.AnnouncementSelect;

export interface LockedAnnouncement {
  readonly id: string;
  readonly schoolId: string;
  readonly status: AnnouncementStatus;
  readonly category: NotificationCategory;
  readonly title: string;
  readonly body: string;
  readonly audience: AnnouncementAudience;
  readonly recipientCount: number | null;
  readonly targets: readonly { readonly classId: string | null; readonly studentId: string | null }[];
}

/** Announcement FOR UPDATE (dalam cakupan sekolah) LALU dibaca ulang. Tidak ada/sekolah lain -> 404. */
export async function lockAnnouncement(tx: Tx, scope: SchoolScope, id: string): Promise<LockedAnnouncement> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT \`id\` FROM \`Announcement\` WHERE \`id\` = ${id} AND \`schoolId\` = ${scope.schoolId} FOR UPDATE`;
  if (locked.length === 0) throw announcementNotFound();
  const row = await tx.announcement.findFirst({ where: { id, schoolId: scope.schoolId }, select: LOCKED_SELECT });
  if (!row) throw announcementNotFound();
  return row;
}

async function foundClassIds(db: Tx, schoolId: string, ids: readonly string[]): Promise<string[]> {
  const rows = await db.schoolClass.findMany({ where: { id: { in: [...ids] }, schoolId, isActive: true }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function foundStudentIds(db: Tx, schoolId: string, ids: readonly string[]): Promise<string[]> {
  const rows = await db.student.findMany({ where: { id: { in: [...ids] }, schoolId, status: { not: "DRAFT" } }, select: { id: true } });
  return rows.map((r) => r.id);
}

/**
 * Target wajib milik sekolah dalam cakupan: kelas AKTIF, siswa non-DRAF. Id asing/tidak ada -> 422
 * INVALID_TARGETS { invalidIds } (pesan sama untuk "tidak ada" dan "sekolah lain").
 */
export async function assertTargetsInSchool(db: Tx, schoolId: string, audience: NormalizedAudience): Promise<void> {
  let invalid: string[] = [];
  if (audience.audience === "CLASSES") invalid = invalidTargetIds(audience.classIds, await foundClassIds(db, schoolId, audience.classIds));
  if (audience.audience === "STUDENTS") invalid = invalidTargetIds(audience.studentIds, await foundStudentIds(db, schoolId, audience.studentIds));
  if (invalid.length > 0) {
    throw unprocessable("INVALID_TARGETS", "Sebagian target tidak ditemukan di sekolah ini atau tidak dapat dipilih.", { invalidIds: invalid });
  }
}

/** Baris AnnouncementTarget (tepat satu kolom terisi, sesuai chk_announcement_target_one). */
export function targetRows(announcementId: string, audience: NormalizedAudience): Prisma.AnnouncementTargetCreateManyInput[] {
  return [
    ...audience.classIds.map((classId) => ({ announcementId, classId })),
    ...audience.studentIds.map((studentId) => ({ announcementId, studentId })),
  ];
}

export async function countRecipients(db: Tx, schoolId: string, audience: NormalizedAudience): Promise<number> {
  return db.student.count({ where: recipientFilter(schoolId, audience) });
}

/** userId penerima saat ini (siswa ACTIVE berakun aktif yang cocok audiens). */
export async function findRecipientUserIds(db: Tx, schoolId: string, audience: NormalizedAudience): Promise<string[]> {
  const rows = await db.student.findMany({ where: recipientFilter(schoolId, audience), select: { userId: true } });
  return rows.map((r) => r.userId);
}
