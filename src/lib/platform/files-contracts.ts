import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";

/**
 * Kontrak route berkas privat generik GET /api/v1/files/{id} (selfie absensi, lampiran izin, bukti
 * bayar, banner/bukti sponsor). Otorisasi per berkas di storage/access.ts (canReadFile): tidak berhak
 * / tidak ada -> 404 (id tak bisa dienumerasi), sudah dihapus retensi -> 410 FILE_PURGED.
 */
export const fileIdParams = z.object({ id: z.string().trim().min(1, "Id wajib diisi.").max(64, "Id terlalu panjang.").meta({ description: "Id berkas." }) });

export const fileDownloadQuery = z.object({
  download: z.enum(["0", "1"]).optional().meta({ description: "1 = Content-Disposition attachment (unduh); default inline (tampil)." }),
});

export const getFileContract = defineContract({
  id: "getPrivateFile",
  method: "GET",
  path: "/api/v1/files/{id}",
  tag: "Berkas",
  summary: "Tampilkan / unduh berkas privat",
  description:
    "Byte berkas dengan Content-Type asli, X-Content-Type-Options nosniff, CSP sandbox, dan Cache-Control private, max-age=300. Siswa: berkas unggahannya sendiri; admin sekolah: selfie/lampiran izin/bukti bayar sekolahnya; sponsor: banner/bukti top-up miliknya; super admin: semua. Tidak berhak atau tidak ada -> 404; sudah dihapus retensi (selfie 180 hari) -> 410 FILE_PURGED.",
  action: "file.read",
  params: fileIdParams,
  query: fileDownloadQuery,
  response: z.unknown(),
  binary: true,
  errors: ["FILE_PURGED"],
});

export const filesContracts: readonly AnyContract[] = [getFileContract];

export interface FileHeaderInput {
  readonly size: number;
  readonly mimeType: string;
  readonly filename: string;
}

/** Nama berkas di header: hanya karakter aman (nama buatan server, tetap disaring defensif). */
const safeFilename = (name: string): string => name.replace(/[^A-Za-z0-9._-]/g, "_");

/** Header respons biner berkas privat (tanpa eksekusi konten, cache privat singkat per token). */
export function fileResponseHeaders(file: FileHeaderInput, asAttachment: boolean): Record<string, string> {
  return {
    "Content-Type": file.mimeType,
    "Content-Length": String(file.size),
    "Content-Disposition": `${asAttachment ? "attachment" : "inline"}; filename="${safeFilename(file.filename)}"`,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
    "Cache-Control": "private, max-age=300",
    "Referrer-Policy": "no-referrer",
    Vary: "Authorization",
  };
}
