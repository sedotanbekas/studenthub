import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { bannerLockKey } from "@/lib/lock-keys";
import { log, safeErrorFields } from "@/lib/log";
import { assertDiskSpace } from "@/lib/storage/disk";
import { storageRoot } from "@/lib/storage/driver";
import { discardFile, persistProcessedFile, publishBannerCopy, unpublishBannerCopy } from "@/lib/storage/files";
import { processImage } from "@/lib/storage/image";
import { resolveSponsorScope } from "@/lib/tenant/scope";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import type { BannerUploadInput } from "./schemas";

/**
 * Banner iklan: diunggah terpisah (JPEG/PNG/WebP 2:1 ±2%, lebar >= 800 -> WebP 1200×600 tanpa EXIF), disimpan
 * PRIVAT (hanya pemilik & super admin via /files/{id}). Salinan publik /media dibuat saat iklan disetujui dan
 * dihapus saat tidak ada lagi iklan APPROVED/PAUSED yang memakainya. Banner tak terpakai (attachedAt NULL,
 * > 24 jam) dibersihkan job files-orphan-cleanup.
 */
export interface BannerDto {
  readonly fileId: string;
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
}

export const bannerNotFound = () => notFound("Banner tidak ditemukan.", "BANNER_NOT_FOUND");

/** POST /sponsor/banners (multipart). */
export async function uploadBanner(ctx: ActionContext, input: BannerUploadInput): Promise<BannerDto> {
  const principal = requirePrincipal(ctx);
  const { sponsorId } = resolveSponsorScope(principal);
  await assertDiskSpace(storageRoot());
  const processed = await processImage(new Uint8Array(await input.file.arrayBuffer()), "AD_BANNER");
  const written: string[] = [];
  try {
    const file = await withTx(async (tx) => {
      const persisted = await persistProcessedFile(
        tx,
        { kind: "AD_BANNER", processed, uploadedById: principal.userId, sponsorId, bucket: "private", attachedAt: null, originalName: input.file.name },
        ctx.now,
      );
      written.push(persisted.storageKey);
      return persisted;
    });
    await Promise.all(written.slice(0, -1).map(discardFile));
    return { fileId: file.id, mimeType: processed.mimeType, width: processed.width, height: processed.height, sizeBytes: processed.sizeBytes };
  } catch (error) {
    await Promise.all(written.map(discardFile));
    throw error;
  }
}

/**
 * Kunci & validasi banner milik sponsor (FOR UPDATE, menahan job pembersih yatim) lalu tandai terpakai.
 * Banner sponsor lain / bukan banner / sudah dihapus -> 404 BANNER_NOT_FOUND.
 */
export async function claimOwnBanner(tx: Tx, fileId: string, sponsorId: string, now: Date): Promise<void> {
  await lockRows(tx, "StoredFile", [fileId]);
  const file = await tx.storedFile.findFirst({ where: { id: fileId, sponsorId, kind: "AD_BANNER", deletedAt: null }, select: { attachedAt: true } });
  if (!file) throw bannerNotFound();
  if (!file.attachedAt) await tx.storedFile.updateMany({ where: { id: fileId, attachedAt: null }, data: { attachedAt: now } });
}

/** Banner yang tidak lagi dirujuk iklan mana pun kembali "yatim" (dibersihkan job setelah 24 jam sejak unggah). */
export async function releaseBannerIfUnused(tx: Tx, fileId: string): Promise<void> {
  const used = await tx.ad.count({ where: { imageFileId: fileId } });
  if (used === 0) await tx.storedFile.updateMany({ where: { id: fileId, kind: "AD_BANNER" }, data: { attachedAt: null } });
}

/** Salin banner ke bucket publik di dalam transaksi persetujuan (pemanggil sudah memegang bannerLockKey). */
export async function publishBannerInTx(tx: Tx, fileId: string): Promise<string> {
  const file = await tx.storedFile.findFirst({ where: { id: fileId, kind: "AD_BANNER", deletedAt: null }, select: { storageKey: true } });
  if (!file) throw bannerNotFound();
  return publishBannerCopy(file.storageKey);
}

/**
 * Samakan salinan publik dengan status iklan (di bawah bannerLockKey): ada iklan APPROVED/PAUSED -> salinan
 * dipastikan ada; tidak ada -> salinan dihapus. Dipanggil setelah commit takedown/tolak/arsip/edit & saat
 * persetujuan gagal. Kegagalan dicatat (tidak menggagalkan respons yang sudah ter-commit).
 */
export async function syncBannerPublication(fileId: string): Promise<void> {
  try {
    await withTx(async (tx) => {
      await lockKey(tx, bannerLockKey(fileId));
      const file = await tx.storedFile.findFirst({ where: { id: fileId, kind: "AD_BANNER" }, select: { storageKey: true, deletedAt: true } });
      if (!file) return;
      const live = await tx.ad.count({ where: { imageFileId: fileId, status: { in: ["APPROVED", "PAUSED"] } } });
      if (live > 0 && !file.deletedAt) await publishBannerCopy(file.storageKey);
      else await unpublishBannerCopy(file.storageKey);
    });
  } catch (error) {
    log.error("ads.banner_sync_failed", { fileId, ...safeErrorFields(error) });
  }
}
