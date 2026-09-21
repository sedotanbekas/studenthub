import type { FileKind } from "@prisma/client";
import { prisma, type Tx } from "@/lib/db";
import { gone, isAppError, notFound } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import { canReadFile, type FileViewer } from "./access";
import { getStorage } from "./driver";
import type { ProcessedImage } from "./image";
import { buildStorageKey, publicKeyFor, type StorageBucket } from "./keys";
import { downloadFilename, sanitizeOriginalName } from "./names";

export { sanitizeOriginalName } from "./names";

/**
 * Layanan berkas (memakai Prisma). Unggahan bersifat inline di endpoint domain: byte ditulis ke disk
 * DULU, lalu baris StoredFile dibuat di transaksi pemanggil. Bila transaksi pemanggil gagal setelahnya,
 * pemanggil WAJIB memanggil discardFile(storageKey) agar tidak ada berkas yatim di disk.
 */
export interface PersistFileInput {
  readonly kind: FileKind;
  readonly processed: ProcessedImage;
  readonly uploadedById: string;
  readonly schoolId?: string | null;
  readonly sponsorId?: string | null;
  readonly originalName?: string | null;
  readonly bucket: StorageBucket;
  readonly attachedAt: Date | null;
}

export interface PersistedFile {
  readonly id: string;
  readonly storageKey: string;
}

export interface FileDownload {
  readonly body: ReadableStream<Uint8Array>;
  readonly size: number;
  readonly mimeType: string;
  readonly filename: string;
}

export async function persistProcessedFile(tx: Tx, input: PersistFileInput, now: Date): Promise<PersistedFile> {
  const { kind, processed } = input;
  const storageKey = buildStorageKey(kind, processed.ext, now, input.bucket);
  await getStorage().put(storageKey, processed.data);
  try {
    const row = await tx.storedFile.create({
      data: {
        kind,
        storageKey,
        mimeType: processed.mimeType,
        sizeBytes: processed.sizeBytes,
        sha256: processed.sha256,
        phash: processed.phash,
        width: processed.width,
        height: processed.height,
        originalName: sanitizeOriginalName(input.originalName),
        schoolId: input.schoolId ?? null,
        sponsorId: input.sponsorId ?? null,
        uploadedById: input.uploadedById,
        attachedAt: input.attachedAt,
        createdAt: now,
      },
      select: { id: true },
    });
    return { id: row.id, storageKey };
  } catch (err) {
    await discardFile(storageKey);
    throw err;
  }
}

/** Hapus berkas di disk secara best effort (kompensasi transaksi gagal). Tidak pernah melempar. */
export async function discardFile(storageKey: string): Promise<void> {
  try {
    await getStorage().delete(storageKey);
  } catch (err) {
    log.warn("storage.discard_failed", { storageKey, ...safeErrorFields(err) });
  }
}

/** Salin banner privat ke bucket publik (saat iklan disetujui); mengembalikan kunci publik. */
export async function publishBannerCopy(privateKey: string): Promise<string> {
  const publicKey = publicKeyFor(privateKey);
  await getStorage().copy(privateKey, publicKey);
  return publicKey;
}

/** Hapus salinan publik banner (takedown/tolak/arsip). Idempoten. */
export async function unpublishBannerCopy(privateKey: string): Promise<boolean> {
  return getStorage().delete(publicKeyFor(privateKey));
}

async function streamStored(fileId: string, storageKey: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  try {
    return await getStorage().stream(storageKey);
  } catch (err) {
    if (isAppError(err) && err.status === 404) log.error("storage.blob_missing", { fileId });
    throw err;
  }
}

/**
 * Buka berkas privat untuk penonton. Lookup memakai findFirst (bukan findUnique by id) karena
 * otorisasi lintas tenant ditentukan canReadFile: DENY/tidak ada → 404, GONE → 410 FILE_PURGED.
 */
export async function openFileForViewer(fileId: string, viewer: FileViewer): Promise<FileDownload> {
  const file = await prisma.storedFile.findFirst({
    where: { id: fileId },
    select: { id: true, kind: true, storageKey: true, mimeType: true, schoolId: true, sponsorId: true, uploadedById: true, deletedAt: true },
  });
  if (!file) throw notFound();
  const access = canReadFile(viewer, file);
  if (access === "DENY") throw notFound();
  if (access === "GONE") throw gone("FILE_PURGED", "Berkas sudah dihapus sesuai kebijakan retensi.");
  const { body, size } = await streamStored(file.id, file.storageKey);
  return { body, size, mimeType: file.mimeType, filename: downloadFilename(file.kind, file.id, file.mimeType) };
}
