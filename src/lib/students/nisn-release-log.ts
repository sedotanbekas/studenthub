import type { Prisma } from "@prisma/client";
import type { ActionContext } from "@/lib/auth/principal";
import { redactForAudit, writeAudit } from "@/lib/audit";
import type { Tx } from "@/lib/db";
import { AppError } from "@/lib/http/errors";
import { notifyRecipients, notifySuperAdmins } from "@/lib/notifications/notify";
import { nisnReleasedNotification } from "@/lib/notifications/templates/students";
import type { ClaimingSchool, ReleasedHolder } from "./nisn-claim";
import { nisnReleaseSuperAdminNotice } from "./nisn-release-notice";
import { NISN_RELEASE_DAILY_LIMIT, claimedCountOf, isReleaseQuotaExempt, localDayWindow, releaseQuotaVerdict } from "./nisn-rules";

/**
 * Jejak pelepasan NISN siswa LULUS lintas sekolah:
 * - `student.nisn_release` per pemegang di sekolah ASAL (aktor sistem, tanpa id sekolah pengklaim);
 * - `student.nisn_release_claimed` SATU baris di sekolah PENGKLAIM (count + NISN, tanpa id asing) —
 *   sumber hitungan kuota harian;
 * - notifikasi NISN_RELEASED ke admin sekolah asal dan ke SEMUA super admin.
 * Kuota dihitung & ditulis di bawah lockKey(nisnReleaseLockKey(claimer.id)).
 */
export const NISN_RELEASE_ACTION = "student.nisn_release";
export const NISN_RELEASE_CLAIMED_ACTION = "student.nisn_release_claimed";

type AuditJson = Prisma.InputJsonValue;

function releaseLimit(verdict: { used: number; remaining: number }, requested: number, resetsAt: Date, now: Date): AppError {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetsAt.getTime() - now.getTime()) / 1000));
  return new AppError(
    429,
    "NISN_RELEASE_LIMIT",
    `Batas pelepasan NISN siswa lulus dari sekolah lain (${NISN_RELEASE_DAILY_LIMIT} per hari) tercapai; sisa kuota hari ini ${verdict.remaining}. Hubungi super admin.`,
    { limit: NISN_RELEASE_DAILY_LIMIT, used: verdict.used, requested, remaining: verdict.remaining, resetsAt: resetsAt.toISOString(), retryAfterSeconds },
    { "Retry-After": String(retryAfterSeconds) },
  );
}

/** Kuota harian (hari lokal sekolah pengklaim) untuk selain super admin; lempar 429 NISN_RELEASE_LIMIT. */
export async function assertReleaseQuota(tx: Tx, claimer: ClaimingSchool, requested: number, ctx: ActionContext): Promise<void> {
  if (requested === 0 || isReleaseQuotaExempt(ctx.principal?.role)) return;
  const day = localDayWindow(ctx.now, claimer.timezone);
  const rows = await tx.auditLog.findMany({
    where: {
      schoolId: claimer.id,
      action: NISN_RELEASE_CLAIMED_ACTION,
      createdAt: { gte: day.start, lt: day.end },
      OR: [{ actorRole: null }, { actorRole: { not: "SUPER_ADMIN" } }],
    },
    select: { after: true },
    // Setiap baris >= 1 pelepasan: lebih dari LIMIT baris pasti sudah melewati kuota.
    take: NISN_RELEASE_DAILY_LIMIT + 1,
  });
  const used = rows.reduce((sum, row) => sum + claimedCountOf(row.after), 0);
  const verdict = releaseQuotaVerdict(used, requested);
  if (!verdict.allowed) throw releaseLimit(verdict, requested, day.end, ctx.now);
}

/** Audit sekolah asal dalam satu INSERT (padanan writeAudit dengan aktor sistem, tanpa IP/UA). */
async function writeOriginAudits(tx: Tx, released: readonly ReleasedHolder[]): Promise<void> {
  await tx.auditLog.createMany({
    data: released.map((holder) => ({
      actorId: null,
      actorRole: null,
      schoolId: holder.schoolId,
      action: NISN_RELEASE_ACTION,
      entityType: "Student",
      entityId: holder.id,
      before: redactForAudit({ activeNisn: holder.nisn, status: "GRADUATED" }) as AuditJson,
      after: redactForAudit({ activeNisn: null, reason: "NISN diaktifkan di sekolah lain" }) as AuditJson,
      ipAddress: null,
      userAgent: null,
    })),
  });
}

async function notifyOriginSchools(tx: Tx, released: readonly ReleasedHolder[], ctx: ActionContext): Promise<void> {
  const schoolIds = [...new Set(released.map((holder) => holder.schoolId))];
  const [holders, admins] = await Promise.all([
    tx.user.findMany({ where: { id: { in: released.map((r) => r.userId) } }, select: { id: true, name: true } }),
    tx.user.findMany({ where: { schoolId: { in: schoolIds }, role: "SCHOOL_ADMIN", isActive: true }, select: { id: true, schoolId: true } }),
  ]);
  const nameOf = new Map(holders.map((u) => [u.id, u.name]));
  for (const schoolId of schoolIds) {
    const info = released.filter((h) => h.schoolId === schoolId).map((h) => ({ studentId: h.id, name: nameOf.get(h.userId) ?? "Siswa", nisn: h.nisn }));
    const recipients = admins.filter((admin) => admin.schoolId === schoolId).map((admin) => ({ userId: admin.id, role: "SCHOOL_ADMIN" as const }));
    await notifyRecipients(tx, recipients, nisnReleasedNotification(info), ctx);
  }
}

/** Tulis seluruh jejak pelepasan (dipanggil TERAKHIR di transaksi klaim). */
export async function recordNisnReleases(tx: Tx, released: readonly ReleasedHolder[], claimer: ClaimingSchool, ctx: ActionContext): Promise<void> {
  if (released.length === 0) return;
  const nisns = released.map((holder) => holder.nisn);
  await writeOriginAudits(tx, released);
  await writeAudit(
    tx,
    { action: NISN_RELEASE_CLAIMED_ACTION, entityType: "School", entityId: claimer.id, schoolId: claimer.id, after: { count: released.length, nisns } },
    ctx,
  );
  await notifyOriginSchools(tx, released, ctx);
  await notifySuperAdmins(tx, nisnReleaseSuperAdminNotice({ claimer, nisns }), ctx);
}
