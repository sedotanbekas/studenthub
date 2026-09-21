import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { isAppError } from "@/lib/http/errors";
import { assertDiskSpace, getFreeDiskBytes, MIN_FREE_DISK_BYTES, type StatFsFn } from "./disk";

const GIB = 1024 ** 3;

function fakeStatfs(freeBytes: number): StatFsFn {
  return async () => ({ bavail: freeBytes / 4096, bsize: 4096 });
}

test("MIN_FREE_DISK_BYTES = 5 GiB", () => {
  assert.equal(MIN_FREE_DISK_BYTES, 5 * GIB);
});

test("assertDiskSpace: di atas ambang lolos, tepat di ambang lolos", async () => {
  await assertDiskSpace("/srv/storage", MIN_FREE_DISK_BYTES, fakeStatfs(6 * GIB));
  await assertDiskSpace("/srv/storage", MIN_FREE_DISK_BYTES, fakeStatfs(5 * GIB));
});

test("assertDiskSpace: di bawah ambang → 503 SERVICE_UNAVAILABLE dengan pesan admin", async () => {
  await assert.rejects(
    assertDiskSpace("/srv/storage", MIN_FREE_DISK_BYTES, fakeStatfs(5 * GIB - 4096)),
    (err: unknown) => isAppError(err) && err.status === 503 && err.code === "SERVICE_UNAVAILABLE"
      && err.message === "Penyimpanan server hampir penuh. Hubungi admin.",
  );
});

test("statfs nyata: direktori temp punya ruang > 1 byte; ambang mustahil → 503", async () => {
  const tmp = os.tmpdir();
  assert.ok((await getFreeDiskBytes(tmp)) > 0);
  await assertDiskSpace(tmp, 1);
  await assert.rejects(assertDiskSpace(tmp, Number.MAX_SAFE_INTEGER), (err: unknown) => isAppError(err) && err.status === 503);
});

test("root belum ada: memakai leluhur terdekat yang ada", async () => {
  const missing = path.join(os.tmpdir(), "sh-belum-ada", "a", "b");
  assert.ok((await getFreeDiskBytes(missing)) > 0);
});

test("galat statfs selain ENOENT diteruskan", async () => {
  const failing: StatFsFn = async () => {
    throw Object.assign(new Error("EACCES"), { code: "EACCES" });
  };
  await assert.rejects(assertDiskSpace("/srv/storage", 1, failing), /EACCES/);
});
