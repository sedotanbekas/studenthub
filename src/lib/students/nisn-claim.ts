import type { ActionContext } from "@/lib/auth/principal";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions } from "@/lib/auth/sessions";
import type { Tx } from "@/lib/db";
import { conflict, type AppError } from "@/lib/http/errors";
import { notifySchoolAdmins } from "@/lib/notifications/notify";
import { nisnReleasedNotification } from "@/lib/notifications/templates/students";
import type { StudentStatusValue } from "./constants";
import { decideNisnClaim } from "./nisn-rules";

/**
 * Klaim activeNisn di DALAM transaksi (aktivasi / reaktivasi / ganti NISN oleh super admin).
 * Pemegang dikunci `FOR UPDATE` lewat indeks unik activeNisn; pemegang LULUS dilepas (activeNisn NULL,
 * sesi dicabut), pemegang AKTIF/NONAKTIF -> 409 NISN_ACTIVE_ELSEWHERE. Audit & notifikasi pelepasan
 * ditulis TERAKHIR lewat `recordNisnReleases` (urutan kunci global).
 */
export interface ReleasedHolder {
  readonly id: string;
  readonly schoolId: string;
  readonly userId: string;
  readonly nisn: string;
}

export type HolderRow = { id: string; status: string; schoolId: string; userId: string };

/** Konteks sistem untuk audit di sekolah asal: tanpa aktor/IP sekolah lain (tanpa id tenant lain). */
const SYSTEM_ACTOR = { principal: null, ip: null, userAgent: null } as const;

export const NISN_ACTIVE_ELSEWHERE_MESSAGE = "NISN masih aktif di sekolah lain; sekolah asal harus menandai Pindah/Lulus terlebih dahulu.";

async function nisnConflict(tx: Tx, holder: HolderRow, ctx: ActionContext): Promise<AppError> {
  if (ctx.principal?.role !== "SUPER_ADMIN") return conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE);
  const school = await tx.school.findUnique({ where: { id: holder.schoolId }, select: { name: true } });
  return conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE, { schoolName: school?.name ?? null, holderStatus: holder.status });
}

export async function claimNisn(
  tx: Tx,
  target: { readonly studentId: string | null; readonly nisn: string },
  ctx: ActionContext,
): Promise<ReleasedHolder | null> {
  const rows = await tx.$queryRaw<HolderRow[]>`SELECT \`id\`, \`status\`, \`schoolId\`, \`userId\` FROM \`Student\` WHERE \`activeNisn\` = ${target.nisn} FOR UPDATE`;
  const holder = rows[0] ?? null;
  const decision = decideNisnClaim(holder && { id: holder.id, status: holder.status as StudentStatusValue }, target.studentId);
  if (decision === "CLAIM" || holder === null) return null;
  if (decision === "CONFLICT") throw await nisnConflict(tx, holder, ctx);
  return releaseHolder(tx, holder, target.nisn, ctx.now);
}

/** Lepas activeNisn pemegang LULUS (compare-and-set) + cabut sesinya. */
export async function releaseHolder(tx: Tx, holder: HolderRow, nisn: string, now: Date): Promise<ReleasedHolder> {
  const released = await tx.student.updateMany({
    where: { id: holder.id, activeNisn: nisn, status: "GRADUATED" },
    data: { activeNisn: null },
  });
  if (released.count !== 1) throw conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE);
  await revokeAllSessions(tx, holder.userId, "ACCOUNT_DISABLED", now);
  return { id: holder.id, schoolId: holder.schoolId, userId: holder.userId, nisn };
}

/** Audit `student.nisn_release` di sekolah ASAL + notifikasi NISN_RELEASED ke admin sekolah asal. */
export async function recordNisnReleases(tx: Tx, released: readonly ReleasedHolder[], ctx: ActionContext): Promise<void> {
  if (released.length === 0) return;
  const users = await tx.user.findMany({ where: { id: { in: released.map((r) => r.userId) } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  for (const holder of released) {
    await writeAudit(
      tx,
      {
        action: "student.nisn_release",
        entityType: "Student",
        entityId: holder.id,
        schoolId: holder.schoolId,
        before: { activeNisn: holder.nisn, status: "GRADUATED" },
        after: { activeNisn: null, reason: "NISN diaktifkan di sekolah lain" },
      },
      SYSTEM_ACTOR,
    );
  }
  const schoolIds = [...new Set(released.map((holder) => holder.schoolId))];
  for (const schoolId of schoolIds) {
    const holders = released.filter((holder) => holder.schoolId === schoolId);
    const info = holders.map((h) => ({ studentId: h.id, name: nameOf.get(h.userId) ?? "Siswa", nisn: h.nisn }));
    await notifySchoolAdmins(tx, schoolId, nisnReleasedNotification(info), ctx);
  }
}
