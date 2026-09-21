import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { notFound } from "@/lib/http/errors";
import type { StorageDriver } from "./driver";
import { parseStorageKey, resolveInsideRoot, type StorageBucket } from "./keys";

/**
 * Driver disk lokal. Tulis atomik: `<root>/tmp/<acak>` (flag 'wx', filesystem sama) lalu rename.
 * Mode: privat dir 0700 / berkas 0600; publik dir 0755 / berkas 0644 (nginx membaca lewat grup/other).
 */
const MODES: Readonly<Record<StorageBucket, { dir: number; file: number }>> = Object.freeze({
  private: Object.freeze({ dir: 0o700, file: 0o600 }),
  public: Object.freeze({ dir: 0o755, file: 0o644 }),
});
const ROOT_DIR_MODE = 0o755;
const TMP_DIR_MODE = 0o700;

function hasCode(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

function fileNotFound(): Error {
  return notFound("Berkas tidak ditemukan.");
}

async function ensureDirs(root: string, bucket: StorageBucket, targetDir: string): Promise<string> {
  const mode = MODES[bucket].dir;
  await mkdir(root, { recursive: true, mode: ROOT_DIR_MODE });
  await mkdir(path.join(root, bucket), { recursive: true, mode });
  await mkdir(targetDir, { recursive: true, mode });
  const tmpDir = path.join(root, "tmp");
  await mkdir(tmpDir, { recursive: true, mode: TMP_DIR_MODE });
  return tmpDir;
}

async function atomicWrite(root: string, key: string, data: Uint8Array): Promise<void> {
  const { bucket } = parseStorageKey(key);
  const target = resolveInsideRoot(root, key);
  const tmpDir = await ensureDirs(root, bucket, path.dirname(target));
  const tmp = path.join(tmpDir, randomBytes(16).toString("hex"));
  await writeFile(tmp, data, { flag: "wx", mode: MODES[bucket].file });
  try {
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

async function readOrNotFound(target: string): Promise<Buffer> {
  try {
    return await readFile(target);
  } catch (err) {
    if (hasCode(err, "ENOENT")) throw fileNotFound();
    throw err;
  }
}

async function openStream(target: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  try {
    const info = await stat(target);
    if (!info.isFile()) throw fileNotFound();
    const body = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream<Uint8Array>;
    return { body, size: info.size };
  } catch (err) {
    if (hasCode(err, "ENOENT")) throw fileNotFound();
    throw err;
  }
}

export function createLocalDriver(rootDir: string): StorageDriver {
  const root = path.resolve(/*turbopackIgnore: true*/ rootDir);
  return {
    put: (key, data) => atomicWrite(root, key, data),
    read: async (key) => readOrNotFound(resolveInsideRoot(root, key)),
    stream: async (key) => openStream(resolveInsideRoot(root, key)),
    async delete(key) {
      const target = resolveInsideRoot(root, key);
      try {
        await unlink(target);
        return true;
      } catch (err) {
        if (hasCode(err, "ENOENT")) return false;
        throw err;
      }
    },
    async exists(key) {
      const target = resolveInsideRoot(root, key);
      try {
        return (await stat(target)).isFile();
      } catch (err) {
        if (hasCode(err, "ENOENT")) return false;
        throw err;
      }
    },
    async copy(fromKey, toKey) {
      parseStorageKey(toKey);
      const data = await readOrNotFound(resolveInsideRoot(root, fromKey));
      await atomicWrite(root, toKey, data);
    },
  };
}
