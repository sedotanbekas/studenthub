import { hasTimeLeft, orphanFileCutoff } from "@/lib/attendance/retention";
import type { JobContext } from "@/lib/auth/principal";
import { Prisma, prisma } from "@/lib/db";
import { log, safeErrorFields } from "@/lib/log";
import { getStorage } from "@/lib/storage/driver";
import { publicKeyFor } from "@/lib/storage/keys";
import { withTx } from "@/lib/tx";
import type { JobResult } from "./types";

/**
 * Job "files-orphan-cleanup" (per jam, desain 05 S10): banner iklan (AD_BANNER) yang tidak pernah
 * dirujuk iklan — attachedAt NULL, dibuat > 24 jam lalu, tanpa Ad yang memakainya — dihapus: byte di
 * disk DULU, baru barisnya. Tiap batch dikunci FOR UPDATE (dengan cek ulang NOT EXISTS Ad) sehingga
 * iklan yang sedang merujuk/menempelkan banner menunggu lalu gagal bersih (404/409), bukan menunjuk
 * byte yang sudah hilang.
 */
const ORPHAN_BATCH = 100;
/** Berhenti bila terlalu banyak berkas gagal dihapus (masalah disk/izin; dicoba lagi jam berikutnya). */
const MAX_FAILED = 500;

export interface StoredBytes {
  readonly id: string;
  readonly storageKey: string;
}

export interface BytesOutcome {
  readonly removed: readonly string[];
  readonly failed: readonly string[];
}

/**
 * Hapus byte berkas (idempoten: berkas yang sudah tidak ada dianggap terhapus). Kegagalan dicatat dan
 * dikembalikan (bukan ditelan diam-diam) agar barisnya tidak ditandai terhapus.
 */
export async function deleteStoredBytes(files: readonly StoredBytes[], extraKeys: (file: StoredBytes) => readonly string[] = () => []): Promise<BytesOutcome> {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      for (const key of [file.storageKey, ...extraKeys(file)]) await getStorage().delete(key);
      removed.push(file.id);
    } catch (error) {
      log.warn("storage.purge_failed", { fileId: file.id, ...safeErrorFields(error) });
      failed.push(file.id);
    }
  }
  return { removed, failed };
}

/** Cakupan test (userIds = pengunggah); null = seluruh database (produksi). */
function uploaderScope(ctx: JobContext): readonly string[] | null {
  return ctx.scope ? (ctx.scope.userIds ?? []) : null;
}

async function findOrphans(cutoff: Date, uploaders: readonly string[] | null, exclude: readonly string[]): Promise<string[]> {
  const rows = await prisma.storedFile.findMany({
    where: {
      kind: "AD_BANNER",
      attachedAt: null,
      deletedAt: null,
      createdAt: { lt: cutoff },
      ads: { none: {} },
      ...(uploaders ? { uploadedById: { in: [...uploaders] } } : {}),
      ...(exclude.length > 0 ? { id: { notIn: [...exclude] } } : {}),
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: ORPHAN_BATCH,
  });
  return rows.map((row) => row.id);
}

/** Kunci & cek ulang batch, hapus byte (privat + salinan publik bila ada), lalu hapus baris yang bytenya hilang. */
function purgeBatch(ids: readonly string[], cutoff: Date): Promise<{ deleted: number; failed: readonly string[] }> {
  return withTx(async (tx) => {
    const locked = await tx.$queryRaw<StoredBytes[]>`
      SELECT f.\`id\`, f.\`storageKey\` FROM \`StoredFile\` AS f
      WHERE f.\`id\` IN (${Prisma.join([...ids])}) AND f.\`kind\` = 'AD_BANNER' AND f.\`attachedAt\` IS NULL
        AND f.\`deletedAt\` IS NULL AND f.\`createdAt\` < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM \`Ad\` AS a WHERE a.\`imageFileId\` = f.\`id\`)
      ORDER BY f.\`id\` FOR UPDATE`;
    const { removed, failed } = await deleteStoredBytes(locked, (file) => [publicKeyFor(file.storageKey)]);
    const deleted = removed.length > 0 ? (await tx.storedFile.deleteMany({ where: { id: { in: [...removed] } } })).count : 0;
    return { deleted, failed };
  });
}

export async function runOrphanFilesCleanup(ctx: JobContext): Promise<JobResult> {
  const uploaders = uploaderScope(ctx);
  if (uploaders?.length === 0) return { deleted: 0, failed: 0 };
  const cutoff = orphanFileCutoff(ctx.now);
  let deleted = 0;
  let failed: readonly string[] = [];
  while (hasTimeLeft(ctx.deadline) && failed.length < MAX_FAILED) {
    const ids = await findOrphans(cutoff, uploaders, failed);
    if (ids.length === 0) break;
    const outcome = await purgeBatch(ids, cutoff);
    deleted += outcome.deleted;
    failed = [...failed, ...outcome.failed];
    if (ids.length < ORPHAN_BATCH) break;
  }
  return { deleted, failed: failed.length };
}
