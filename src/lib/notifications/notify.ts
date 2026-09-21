import type { NotificationCategory, NotificationType, Prisma, UserRole } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { kickPushDispatch } from "@/lib/push/kick";
import { initialPushStatus, NOTIFICATION_TITLE_MAX, previewText, resolveCategory } from "./rules";

/**
 * SATU-SATUNYA jalur tulis notifikasi. Dipanggil di DALAM transaksi bisnis (rollback = tanpa
 * notifikasi). Siswa mendapat pushStatus PENDING (dikirim dispatcher), peran lain SKIPPED.
 */
export interface NotificationEvent {
  type: NotificationType;
  /** Wajib untuk ANNOUNCEMENT; tipe lain memakai peta kategori. */
  category?: NotificationCategory;
  title: string;
  body: string;
  /** Deep link untuk app/dashboard, mis. { screen: "invoice", id }. */
  link?: { screen: string; id: string };
  announcementId?: string;
}

export interface NotifyContext {
  now: Date;
  defer?: (task: () => Promise<void>) => void;
}

type Recipient = { userId: string; role: UserRole };
const FAN_OUT_CHUNK = 500;

export async function notifyRecipients(tx: Tx, recipients: readonly Recipient[], event: NotificationEvent, ctx: NotifyContext): Promise<number> {
  const unique = [...new Map(recipients.map((r) => [r.userId, r])).values()];
  if (unique.length === 0) return 0;
  const category = resolveCategory(event.type, event.category);
  const data: Prisma.InputJsonValue | undefined = event.link ? { screen: event.link.screen, id: event.link.id } : undefined;
  const rows = unique.map((r) => ({
    userId: r.userId,
    type: event.type,
    category,
    title: event.title.slice(0, NOTIFICATION_TITLE_MAX),
    body: previewText(event.body),
    data,
    announcementId: event.announcementId ?? null,
    pushStatus: initialPushStatus(r.role),
    pushNextAttemptAt: ctx.now,
    createdAt: ctx.now,
  }));
  let created = 0;
  for (let i = 0; i < rows.length; i += FAN_OUT_CHUNK) {
    const result = await tx.notification.createMany({ data: rows.slice(i, i + FAN_OUT_CHUNK), skipDuplicates: Boolean(event.announcementId) });
    created += result.count;
  }
  if (rows.some((row) => row.pushStatus === "PENDING")) ctx.defer?.(kickPushDispatch);
  return created;
}

export async function notifyUsers(tx: Tx, userIds: readonly string[], event: NotificationEvent, ctx: NotifyContext): Promise<number> {
  if (userIds.length === 0) return 0;
  const users = await tx.user.findMany({ where: { id: { in: [...userIds] }, isActive: true }, select: { id: true, role: true } });
  return notifyRecipients(tx, users.map((u) => ({ userId: u.id, role: u.role })), event, ctx);
}

export async function notifyStudents(tx: Tx, studentIds: readonly string[], event: NotificationEvent, ctx: NotifyContext): Promise<number> {
  if (studentIds.length === 0) return 0;
  const students = await tx.student.findMany({
    where: { id: { in: [...studentIds] }, user: { isActive: true } },
    select: { userId: true },
  });
  return notifyRecipients(tx, students.map((s) => ({ userId: s.userId, role: "STUDENT" as const })), event, ctx);
}

export async function notifySchoolAdmins(tx: Tx, schoolId: string, event: NotificationEvent, ctx: NotifyContext): Promise<number> {
  const admins = await tx.user.findMany({ where: { schoolId, role: "SCHOOL_ADMIN", isActive: true }, select: { id: true } });
  return notifyRecipients(tx, admins.map((a) => ({ userId: a.id, role: "SCHOOL_ADMIN" as const })), event, ctx);
}

export async function notifySuperAdmins(tx: Tx, event: NotificationEvent, ctx: NotifyContext): Promise<number> {
  const admins = await tx.user.findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: { id: true } });
  return notifyRecipients(tx, admins.map((a) => ({ userId: a.id, role: "SUPER_ADMIN" as const })), event, ctx);
}

export async function notifySponsorMembers(tx: Tx, sponsorId: string, event: NotificationEvent, ctx: NotifyContext): Promise<number> {
  const members = await tx.user.findMany({ where: { sponsorId, role: "SPONSOR", isActive: true }, select: { id: true } });
  return notifyRecipients(tx, members.map((m) => ({ userId: m.id, role: "SPONSOR" as const })), event, ctx);
}
