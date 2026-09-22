import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resetEnvCache } from "@/lib/env";
import { getStorage, setStorageDriver, storageRoot, type StorageDriver } from "./driver";

const cleanup: string[] = [];
after(async () => {
  setStorageDriver(null);
  resetEnvCache();
  for (const dir of cleanup) await rm(dir, { recursive: true, force: true });
});

function setTestEnv(storageRoot: string): void {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: "mysql://u:p@127.0.0.1:3307/studenthub_test",
    JWT_ACCESS_SECRET: "j".repeat(32),
    AD_EVENT_SECRET: "a".repeat(32),
    JOB_SECRET: "b".repeat(32),
    TOTP_ENC_KEY: "cd".repeat(32),
    APP_ORIGIN: "http://localhost:3030",
    PUBLIC_MEDIA_BASE_URL: "http://localhost:3030/media",
    STORAGE_ROOT: storageRoot,
  });
  resetEnvCache();
}

test("getStorage: singleton driver lokal di STORAGE_ROOT", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "sh-driver-"));
  cleanup.push(root);
  setTestEnv(root);
  setStorageDriver(null);
  const a = getStorage();
  assert.equal(getStorage(), a);
  const key = `private/leave-attachment/2026/09/${Buffer.alloc(16, 5).toString("base64url")}.jpg`;
  await a.put(key, new Uint8Array([4, 2]));
  assert.ok((await stat(path.join(root, key))).isFile());
});

test("storageRoot: STORAGE_ROOT relatif diselesaikan terhadap cwd", () => {
  setTestEnv(".storage-uji");
  assert.equal(storageRoot(), path.resolve(process.cwd(), ".storage-uji"));
  assert.ok(path.isAbsolute(storageRoot()));
});

test("setStorageDriver: driver pengganti untuk test, null mengembalikan default", () => {
  const fake: StorageDriver = {
    put: async () => undefined,
    read: async () => Buffer.alloc(0),
    stream: async () => ({ body: new ReadableStream<Uint8Array>(), size: 0 }),
    delete: async () => false,
    exists: async () => false,
    copy: async () => undefined,
  };
  setStorageDriver(fake);
  assert.equal(getStorage(), fake);
  setStorageDriver(null);
  assert.notEqual(getStorage(), fake);
});
