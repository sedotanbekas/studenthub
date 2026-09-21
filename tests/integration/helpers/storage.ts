/**
 * STORAGE_ROOT sementara per berkas test (di bawah os.tmpdir()) agar test berkas tidak saling
 * mengganggu dan tidak mengotori ./.storage.
 *
 *   let storage: TempStorage;
 *   before(async () => { storage = await createTempStorage(); });
 *   after(() => storage.cleanup());
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetEnvCache } from "../../../src/lib/env";

export interface TempStorage {
  /** Path absolut direktori sementara (sudah dipasang ke process.env.STORAGE_ROOT). */
  readonly root: string;
  /** Kembalikan STORAGE_ROOT sebelumnya lalu hapus direktori sementara beserta isinya. */
  cleanup(): Promise<void>;
}

const REMOVE_RETRIES = 3;

function restoreStorageRoot(previous: string | undefined): void {
  if (previous === undefined) delete process.env.STORAGE_ROOT;
  else process.env.STORAGE_ROOT = previous;
  resetEnvCache();
}

/**
 * Buat direktori sementara, pasang sebagai STORAGE_ROOT, dan reset cache getEnv() agar modul
 * yang membaca env secara malas melihat nilai baru. Panggil sebelum layanan storage dipakai.
 */
export async function createTempStorage(prefix = "studenthub-test-"): Promise<TempStorage> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const previous = process.env.STORAGE_ROOT;
  process.env.STORAGE_ROOT = root;
  resetEnvCache();
  let cleaned = false;
  return {
    root,
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      restoreStorageRoot(previous);
      await rm(root, { recursive: true, force: true, maxRetries: REMOVE_RETRIES });
    },
  };
}
