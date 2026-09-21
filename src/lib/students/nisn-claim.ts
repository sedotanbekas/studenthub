import type { ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, type AppError } from "@/lib/http/errors";
import type { SchoolTz } from "@/lib/time/zone";
import type { StudentStatusValue } from "./constants";
import { assertReleaseQuota } from "./nisn-release-log";
import { decideNisnClaim } from "./nisn-rules";

/**
 * Klaim activeNisn di DALAM transaksi (aktivasi / reaktivasi / ganti NISN oleh super admin / impor).
 * Pemegang dikunci `FOR UPDATE` lewat indeks unik activeNisn; pemegang AKTIF/NONAKTIF -> 409
 * NISN_ACTIVE_ELSEWHERE. Pemegang LULUS di sekolah lain HANYA dilepas bila pemanggil ikut serta secara
 * eksplisit (`confirmRelease`, 409 NISN_HELD_BY_GRADUATE bila tidak) dan kuota harian sekolah
 * pengklaim masih cukup (429 NISN_RELEASE_LIMIT; super admin dikecualikan). Pemanggil WAJIB sudah
 * memegang lockKey(nisnReleaseLockKey(claimer.id)) (lihat lock-plan.ts). Audit & notifikasi pelepasan
 * ditulis TERAKHIR lewat `recordNisnReleases` (nisn-release-log.ts).
 */
export interface ReleasedHolder {
  readonly id: string;
  readonly schoolId: string;
  readonly userId: string;
  readonly nisn: string;
}

export type HolderRow = { id: string; status: string; schoolId: string; userId: string };
/** Pemegang yang sudah dikunci FOR UPDATE beserta NISN yang dipegangnya. */
export type LockedHolder = HolderRow & { activeNisn: string };

export interface ClaimingSchool {
  readonly id: string;
  readonly name: string;
  readonly timezone: SchoolTz;
}

export interface ReleasePolicy {
  /** Opt-in eksplisit (confirmReleaseGraduatedNisn) untuk melepas NISN siswa LULUS di sekolah lain. */
  readonly confirmRelease: boolean;
  /** Sekolah yang mengklaim NISN (kuota, audit student.nisn_release_claimed, notifikasi super admin). */
  readonly claimer: ClaimingSchool;
}

export const NISN_ACTIVE_ELSEWHERE_MESSAGE = "NISN masih aktif di sekolah lain; sekolah asal harus menandai Pindah/Lulus terlebih dahulu.";
export const NISN_HELD_BY_GRADUATE_MESSAGE =
  "NISN masih tercatat pada siswa LULUS di sekolah lain. Kirim confirmReleaseGraduatedNisn=true untuk melepas akun lama siswa tersebut (tercatat di audit dan dilaporkan ke super admin).";

export function nisnHeldByGraduate(details?: unknown): AppError {
  return conflict("NISN_HELD_BY_GRADUATE", NISN_HELD_BY_GRADUATE_MESSAGE, details);
}

async function nisnConflict(tx: Tx, holder: HolderRow, ctx: ActionContext): Promise<AppError> {
  if (ctx.principal?.role !== "SUPER_ADMIN") return conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE);
  const school = await tx.school.findUnique({ where: { id: holder.schoolId }, select: { name: true } });
  return conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE, { schoolName: school?.name ?? null, holderStatus: holder.status });
}

export async function claimNisn(
  tx: Tx,
  target: { readonly studentId: string | null; readonly nisn: string },
  ctx: ActionContext,
  policy: ReleasePolicy,
): Promise<ReleasedHolder | null> {
  const rows = await tx.$queryRaw<LockedHolder[]>`SELECT \`id\`, \`status\`, \`schoolId\`, \`userId\`, \`activeNisn\` FROM \`Student\` WHERE \`activeNisn\` = ${target.nisn} FOR UPDATE`;
  const holder = rows[0] ?? null;
  const decision = decideNisnClaim(holder && { id: holder.id, status: holder.status as StudentStatusValue }, target.studentId);
  if (decision === "CLAIM" || holder === null) return null;
  if (decision === "CONFLICT") throw await nisnConflict(tx, holder, ctx);
  const [released] = await releaseGraduates(tx, [holder], ctx, policy);
  return released ?? null;
}

/**
 * Lepas activeNisn para pemegang LULUS yang SUDAH dikunci (satu UPDATE compare-and-set + satu pencabutan
 * sesi untuk semua; tanpa query per pemegang). Opt-in & kuota diperiksa lebih dulu.
 */
export async function releaseGraduates(tx: Tx, holders: readonly LockedHolder[], ctx: ActionContext, policy: ReleasePolicy): Promise<ReleasedHolder[]> {
  if (holders.length === 0) return [];
  if (!policy.confirmRelease) throw nisnHeldByGraduate({ count: holders.length });
  await assertReleaseQuota(tx, policy.claimer, holders.length, ctx);
  const released = await tx.student.updateMany({
    where: { id: { in: holders.map((h) => h.id) }, activeNisn: { in: holders.map((h) => h.activeNisn) }, status: "GRADUATED" },
    data: { activeNisn: null },
  });
  if (released.count !== holders.length) throw conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE);
  // Sama dengan revokeAllSessions (src/lib/auth/sessions.ts), sekaligus untuk semua pemegang.
  await tx.authSession.updateMany({
    where: { userId: { in: holders.map((h) => h.userId) }, revokedAt: null },
    data: { revokedAt: ctx.now, revokeReason: "ACCOUNT_DISABLED", expoPushToken: null },
  });
  return holders.map((h) => ({ id: h.id, schoolId: h.schoolId, userId: h.userId, nisn: h.activeNisn }));
}
