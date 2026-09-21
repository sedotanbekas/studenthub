import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { DELETE_CHUNK, FILE_PURGE_BATCH, hasTimeLeft, retentionCutoffs, type RetentionCutoffs } from "@/lib/attendance/retention";
import type { JobContext } from "@/lib/auth/principal";
import { Prisma, prisma } from "@/lib/db";
import { deleteStoredBytes } from "./files-cleanup";
import type { JobResult } from "./types";

/**
 * Job "maintenance-daily" (desain 05 J2; PLAN "File & job"). Setiap bagian mengembalikan hitungan,
 * berhenti di ctx.deadline (sisa dikerjakan besok), dan aman diulang:
 * - selfie ATTENDANCE_SELFIE > 180 hari: byte dihapus lalu deletedAt diisi (baris & absensi tetap; unduhan -> 410);
 * - CheckInRejection > 90 hari; RefreshToken ditukar > 30 hari / kedaluwarsa > 1 hari;
 *   AuthSession dicabut/kedaluwarsa > 90 hari; Notification > 365 hari;
 * - JobRun > 90 hari kecuali "auto-alpha" (400 hari, dipakai analitik hari tertutup).
 * Tabel besar dihapus dengan DELETE ... LIMIT 5000 berulang (tanpa NOW(): tenggat dari ctx.now).
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

const purgeSelfies: Section = async (ctx, cutoffs) => {
  const schoolIds = scopeOf(ctx, "schoolIds");
  if (isEmptyScope(schoolIds)) return { purged: 0, failed: 0 };
  let purged = 0;
  let failed: readonly string[] = [];
  while (hasTimeLeft(ctx.deadline) && failed.length < MAX_FAILED_FILES) {
    const batch = await prisma.storedFile.findMany({
      where: {
        kind: "ATTENDANCE_SELFIE",
        deletedAt: null,
        createdAt: { lt: cutoffs.selfie },
        ...(schoolIds ? { schoolId: { in: [...schoolIds] } } : {}),
        ...(failed.length > 0 ? { id: { notIn: [...failed] } } : {}),
      },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: "asc" },
      take: FILE_PURGE_BATCH,
    });
    if (batch.length === 0) break;
    const outcome = await deleteStoredBytes(batch);
    failed = [...failed, ...outcome.failed];
    if (outcome.removed.length > 0) {
      const marked = await prisma.storedFile.updateMany({ where: { id: { in: [...outcome.removed] }, deletedAt: null }, data: { deletedAt: ctx.now } });
      purged += marked.count;
    }
    if (batch.length < FILE_PURGE_BATCH) break;
  }
  return { purged, failed: failed.length };
};

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

const cleanupAuth: Section = async (ctx, cutoffs) => {
  const userIds = scopeOf(ctx, "userIds");
  if (isEmptyScope(userIds)) return { refreshTokens: 0, sessions: 0 };
  const cutoff = cutoffs.deadSession;
  // Sesi mati dulu: RefreshToken miliknya ikut terhapus kaskade (FK ON DELETE CASCADE).
  const sessions = await drain(ctx, () =>
    prisma.$executeRaw`DELETE FROM \`AuthSession\` WHERE (\`revokedAt\` < ${cutoff} OR \`expiresAt\` < ${cutoff}) ${inFilter("userId", userIds)} LIMIT ${LIMIT}`,
  );
  const refreshTokens = await deleteRefreshTokens(ctx, cutoffs, userIds);
  return { refreshTokens, sessions };
};

const deleteNotifications: Section = async (ctx, cutoffs) => {
  const userIds = scopeOf(ctx, "userIds");
  if (isEmptyScope(userIds)) return { deleted: 0 };
  const deleted = await drain(ctx, () =>
    prisma.$executeRaw`DELETE FROM \`Notification\` WHERE \`createdAt\` < ${cutoffs.notification} ${inFilter("userId", userIds)} LIMIT ${LIMIT}`,
  );
  return { deleted };
};

const deleteJobRuns: Section = async (ctx, cutoffs) => {
  const scopeKeys = scopeOf(ctx, "schoolIds");
  if (isEmptyScope(scopeKeys)) return { deleted: 0 };
  const deleted = await drain(ctx, () =>
    prisma.$executeRaw`DELETE FROM \`JobRun\`
      WHERE ((\`job\` <> ${AUTO_ALPHA_JOB} AND \`startedAt\` < ${cutoffs.jobRun}) OR (\`job\` = ${AUTO_ALPHA_JOB} AND \`startedAt\` < ${cutoffs.autoAlphaRun}))
      ${inFilter("scopeKey", scopeKeys)} LIMIT ${LIMIT}`,
  );
  return { deleted };
};

const SECTIONS: ReadonlyArray<readonly [string, Section]> = [
  ["selfies", purgeSelfies],
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
