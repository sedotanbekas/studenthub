import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { DELETE_CHUNK, FILE_PURGE_BATCH, hasTimeLeft, retentionCutoffs, type RetentionCutoffs } from "@/lib/attendance/retention";
import type { JobContext } from "@/lib/auth/principal";
import { Prisma, prisma } from "@/lib/db";
import { purgeFileBytes } from "./files-cleanup";
import type { JobResult } from "./types";

/**
 * Job "maintenance-daily" (desain 05 J2; PLAN "File & job"). Setiap bagian mengembalikan hitungan,
 * berhenti di ctx.deadline (sisa dikerjakan besok), dan aman diulang:
 * - selfie ATTENDANCE_SELFIE > 180 hari: byte dihapus lalu deletedAt diisi (baris & absensi tetap; unduhan -> 410);
 * - lampiran izin (LEAVE_ATTACHMENT) milik izin DIBATALKAN, atau DITOLAK > 30 hari: sama seperti selfie;
 * - CheckInRejection > 90 hari; RefreshToken ditukar > 30 hari / kedaluwarsa > 1 hari;
 *   AuthSession dicabut/kedaluwarsa > 90 hari; Notification > 365 hari;
 * - JobRun > 90 hari kecuali "auto-alpha" (400 hari, dipakai analitik hari tertutup).
 * Tabel besar dihapus per 5000 baris berulang (tanpa NOW(): tenggat dari ctx.now): CheckInRejection lewat
 * DELETE ... LIMIT ber-indeks createdAt; Notification, AuthSession, RefreshToken & JobRun lewat SELECT id
 * ber-indeks lalu DELETE by PK (tanpa next-key lock atas baris yang tidak dihapus).
 */
type Ids = readonly string[] | null;
type SectionResult = Readonly<Record<string, number>>;
type Section = (ctx: JobContext, cutoffs: RetentionCutoffs) => Promise<SectionResult>;

const MAX_FAILED_FILES = 1000;

/** Cakupan test; null = seluruh database (produksi). Daftar kosong = bagian itu tidak menyentuh apa pun. */
function scopeOf(ctx: JobContext, key: "schoolIds" | "userIds"): Ids {
  return ctx.scope ? (ctx.scope[key] ?? []) : null;
}

const isEmptyScope = (ids: Ids): boolean => ids !== null && ids.length === 0;

function inFilter(column: string, ids: Ids): Prisma.Sql {
  return ids === null ? Prisma.empty : Prisma.sql`AND ${Prisma.raw(`\`${column}\``)} IN (${Prisma.join([...ids])})`;
}

/** Ulangi DELETE ... LIMIT sampai batch tidak penuh atau anggaran waktu habis. */
async function drain(ctx: JobContext, step: () => Promise<number>): Promise<number> {
  let total = 0;
  while (hasTimeLeft(ctx.deadline)) {
    const count = await step();
    total += count;
    if (count < DELETE_CHUNK) break;
  }
  return total;
}

const LIMIT = Prisma.raw(String(DELETE_CHUNK));

/**
 * SELECT id (baca konsisten TANPA kunci, lewat indeks retensi) lalu DELETE by PK. DELETE ... WHERE kolom < x
 * LIMIT di autocommit REPEATABLE READ memberi next-key lock pada SETIAP baris yang dipindai (pass terakhir
 * memindai sampai ujung) sehingga INSERT/UPDATE tabel itu tertahan; pola ini hanya mengunci baris yang dihapus.
 */
function drainByIds(ctx: JobContext, findIds: () => Promise<Array<{ id: string }>>, remove: (ids: string[]) => Promise<number>): Promise<number> {
  return drain(ctx, async () => {
    const rows = await findIds();
    return rows.length === 0 ? 0 : remove(rows.map((row) => row.id));
  });
}

/** Musnahkan byte berkas yang cocok `where` per batch (byte dulu, lalu deletedAt) sampai habis/anggaran habis. */
async function purgeFilesWhere(ctx: JobContext, where: Prisma.StoredFileWhereInput): Promise<SectionResult> {
  const schoolIds = scopeOf(ctx, "schoolIds");
  if (isEmptyScope(schoolIds)) return { purged: 0, failed: 0 };
  let purged = 0;
  let failed: readonly string[] = [];
  while (hasTimeLeft(ctx.deadline) && failed.length < MAX_FAILED_FILES) {
    const batch = await prisma.storedFile.findMany({
      where: {
        ...where,
        deletedAt: null,
        ...(schoolIds ? { schoolId: { in: [...schoolIds] } } : {}),
        ...(failed.length > 0 ? { id: { notIn: [...failed] } } : {}),
      },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: "asc" },
      take: FILE_PURGE_BATCH,
    });
    if (batch.length === 0) break;
    const outcome = await purgeFileBytes(batch, ctx.now);
    purged += outcome.purged;
    failed = [...failed, ...outcome.failed];
    if (batch.length < FILE_PURGE_BATCH) break;
  }
  return { purged, failed: failed.length };
}

const purgeSelfies: Section = (ctx, cutoffs) => purgeFilesWhere(ctx, { kind: "ATTENDANCE_SELFIE", createdAt: { lt: cutoffs.selfie } });

/** Lampiran izin DIBATALKAN (segera) dan DITOLAK > 30 hari setelah ditinjau; PENDING/APPROVED tetap. */
const purgeLeaveAttachments: Section = (ctx, cutoffs) =>
  purgeFilesWhere(ctx, {
    kind: "LEAVE_ATTACHMENT",
    leaveRequest: { is: { OR: [{ status: "CANCELLED" }, { status: "REJECTED", reviewedAt: { lt: cutoffs.rejectedLeaveAttachment } }] } },
  });

const deleteRejections: Section = async (ctx, cutoffs) => {
  const schoolIds = scopeOf(ctx, "schoolIds");
  if (isEmptyScope(schoolIds)) return { deleted: 0 };
  const deleted = await drain(ctx, () =>
    prisma.$executeRaw`DELETE FROM \`CheckInRejection\` WHERE \`createdAt\` < ${cutoffs.rejection} ${inFilter("schoolId", schoolIds)} LIMIT ${LIMIT}`,
  );
  return { deleted };
};

async function deleteRefreshTokens(ctx: JobContext, cutoffs: RetentionCutoffs, userIds: Ids): Promise<number> {
  return drain(ctx, async () => {
    const rows = await prisma.refreshToken.findMany({
      where: {
        OR: [{ rotatedAt: { lt: cutoffs.rotatedRefreshToken } }, { expiresAt: { lt: cutoffs.expiredRefreshToken } }],
        ...(userIds ? { session: { userId: { in: [...userIds] } } } : {}),
      },
      select: { id: true },
      take: DELETE_CHUNK,
    });
    if (rows.length === 0) return 0;
    return (await prisma.refreshToken.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } })).count;
  });
}

/** Sesi dicabut / kedaluwarsa sebelum `cutoff`: satu drain per kondisi (OR menghalangi pemakaian indeks). */
async function deleteDeadSessions(ctx: JobContext, cutoff: Date, userIds: Ids): Promise<number> {
  const users = userIds ? { userId: { in: [...userIds] } } : {};
  const conditions = [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] as const;
  let deleted = 0;
  for (const condition of conditions) {
    deleted += await drainByIds(
      ctx,
      () => prisma.authSession.findMany({ where: { ...condition, ...users }, select: { id: true }, take: DELETE_CHUNK }),
      async (ids) => (await prisma.authSession.deleteMany({ where: { id: { in: ids }, ...condition } })).count,
    );
  }
  return deleted;
}

const cleanupAuth: Section = async (ctx, cutoffs) => {
  const userIds = scopeOf(ctx, "userIds");
  if (isEmptyScope(userIds)) return { refreshTokens: 0, sessions: 0 };
  // Sesi mati dulu: RefreshToken miliknya ikut terhapus kaskade (FK ON DELETE CASCADE).
  const sessions = await deleteDeadSessions(ctx, cutoffs.deadSession, userIds);
  const refreshTokens = await deleteRefreshTokens(ctx, cutoffs, userIds);
  return { refreshTokens, sessions };
};

const deleteNotifications: Section = async (ctx, cutoffs) => {
  const userIds = scopeOf(ctx, "userIds");
  if (isEmptyScope(userIds)) return { deleted: 0 };
  const old = { createdAt: { lt: cutoffs.notification } };
  const where = { ...old, ...(userIds ? { userId: { in: [...userIds] } } : {}) };
  const deleted = await drainByIds(
    ctx,
    () => prisma.notification.findMany({ where, select: { id: true }, orderBy: { createdAt: "asc" }, take: DELETE_CHUNK }),
    async (ids) => (await prisma.notification.deleteMany({ where: { id: { in: ids }, ...old } })).count,
  );
  return { deleted };
};

const deleteJobRuns: Section = async (ctx, cutoffs) => {
  const scopeKeys = scopeOf(ctx, "schoolIds");
  if (isEmptyScope(scopeKeys)) return { deleted: 0 };
  const scope = scopeKeys ? { scopeKey: { in: [...scopeKeys] } } : {};
  const conditions = [
    { job: AUTO_ALPHA_JOB, startedAt: { lt: cutoffs.autoAlphaRun } },
    { job: { not: AUTO_ALPHA_JOB }, startedAt: { lt: cutoffs.jobRun } },
  ];
  let deleted = 0;
  for (const condition of conditions) {
    deleted += await drainByIds(
      ctx,
      () => prisma.jobRun.findMany({ where: { ...condition, ...scope }, select: { id: true }, take: DELETE_CHUNK }),
      async (ids) => (await prisma.jobRun.deleteMany({ where: { id: { in: ids }, ...condition } })).count,
    );
  }
  return { deleted };
};

const SECTIONS: ReadonlyArray<readonly [string, Section]> = [
  ["selfies", purgeSelfies],
  ["leaveAttachments", purgeLeaveAttachments],
  ["checkInRejections", deleteRejections],
  ["auth", cleanupAuth],
  ["notifications", deleteNotifications],
  ["jobRuns", deleteJobRuns],
];

export async function runMaintenanceDaily(ctx: JobContext): Promise<JobResult> {
  const cutoffs = retentionCutoffs(ctx.now);
  const results: Record<string, SectionResult> = {};
  const skipped: string[] = [];
  for (const [name, section] of SECTIONS) {
    if (!hasTimeLeft(ctx.deadline)) {
      skipped.push(name);
      continue;
    }
    results[name] = await section(ctx, cutoffs);
  }
  return { ...results, skipped };
}
