import path from "node:path";
import { getEnv } from "@/lib/env";
import { createLocalDriver } from "./local-driver";

/**
 * Abstraksi penyimpanan berkas. Semua kunci wajib lolos parseStorageKey (lihat keys.ts).
 * Implementasi saat ini: disk lokal di STORAGE_ROOT (di luar direktori aplikasi di produksi).
 */
export interface StorageDriver {
  /** Tulis atomik (tmp + rename); menimpa bila kunci sudah ada. */
  put(key: string, data: Uint8Array): Promise<void>;
  /** 404 NOT_FOUND bila berkas tidak ada. */
  read(key: string): Promise<Buffer>;
  /** 404 NOT_FOUND bila berkas tidak ada. */
  stream(key: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }>;
  /** Idempoten: true bila terhapus, false bila memang sudah tidak ada. */
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  /** Salin (mis. banner privat → salinan publik setelah iklan disetujui). */
  copy(fromKey: string, toKey: string): Promise<void>;
}

let instance: StorageDriver | null = null;

/** Path absolut STORAGE_ROOT (relatif → terhadap process.cwd()); dipakai juga untuk assertDiskSpace & health. */
export function storageRoot(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), getEnv().STORAGE_ROOT);
}

/** Driver tunggal proses ini (disk lokal di storageRoot()). */
export function getStorage(): StorageDriver {
  instance ??= createLocalDriver(storageRoot());
  return instance;
}

/** Hanya untuk test: pasang driver pengganti; null = kembali ke driver default dari env. */
export function setStorageDriver(driver: StorageDriver | null): void {
  instance = driver;
}
