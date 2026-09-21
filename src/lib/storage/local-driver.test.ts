import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppError } from "@/lib/http/errors";
import { createLocalDriver } from "./local-driver";
import type { StorageDriver } from "./driver";

const IS_WINDOWS = process.platform === "win32";
const idOf = (n: number): string => Buffer.alloc(16, n).toString("base64url");
const SELFIE = `private/attendance-selfie/2026/09/${idOf(1)}.jpg`;
const BANNER_PRIVATE = `private/ad-banner/2026/09/${idOf(2)}.webp`;
const BANNER_PUBLIC = `public/ad-banner/2026/09/${idOf(2)}.webp`;

let root = "";
let driver: StorageDriver;

before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "sh-storage-"));
  driver = createLocalDriver(root);
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

async function readAll(body: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

test("put → read → exists: isi sama, tmp bersih, mode privat 0600/0700", async () => {
  const data = new Uint8Array([1, 2, 3, 4, 5]);
  await driver.put(SELFIE, data);
  assert.deepEqual(new Uint8Array(await driver.read(SELFIE)), data);
  assert.equal(await driver.exists(SELFIE), true);
  assert.deepEqual(await readdir(path.join(root, "tmp")), []);
  if (!IS_WINDOWS) {
    assert.equal((await stat(path.join(root, SELFIE))).mode & 0o777, 0o600);
    assert.equal((await stat(path.join(root, "private"))).mode & 0o777, 0o700);
  }
});

test("put menimpa kunci yang sama secara atomik", async () => {
  await driver.put(SELFIE, new Uint8Array([9, 9]));
  assert.deepEqual([...(await driver.read(SELFIE))], [9, 9]);
});

test("stream: body ReadableStream + size", async () => {
  const payload = Buffer.alloc(200_000, 7);
  await driver.put(BANNER_PRIVATE, payload);
  const { body, size } = await driver.stream(BANNER_PRIVATE);
  assert.equal(size, payload.length);
  assert.ok((await readAll(body)).equals(payload));
});

test("copy: private/ad-banner → public/ad-banner dengan mode publik 0644/0755", async () => {
  await driver.copy(BANNER_PRIVATE, BANNER_PUBLIC);
  assert.ok((await driver.read(BANNER_PUBLIC)).equals(await driver.read(BANNER_PRIVATE)));
  if (!IS_WINDOWS) {
    assert.equal((await stat(path.join(root, BANNER_PUBLIC))).mode & 0o777, 0o644);
    assert.equal((await stat(path.join(root, "public", "ad-banner"))).mode & 0o777, 0o755);
  }
});

test("delete idempoten: true lalu false; read/stream setelahnya → 404", async () => {
  assert.equal(await driver.delete(BANNER_PUBLIC), true);
  assert.equal(await driver.delete(BANNER_PUBLIC), false);
  assert.equal(await driver.exists(BANNER_PUBLIC), false);
  const is404 = (err: unknown): boolean => isAppError(err) && err.status === 404;
  await assert.rejects(driver.read(BANNER_PUBLIC), is404);
  await assert.rejects(driver.stream(BANNER_PUBLIC), is404);
  await assert.rejects(driver.copy(BANNER_PUBLIC, `public/ad-banner/2026/09/${idOf(3)}.webp`), is404);
});

test("kunci tidak sah ditolak sebelum menyentuh disk", async () => {
  const bad = (err: unknown): boolean => isAppError(err) && err.code === "INVALID_STORAGE_KEY";
  await assert.rejects(driver.put("../escape.jpg", new Uint8Array([1])), bad);
  await assert.rejects(driver.put(`public/attendance-selfie/2026/09/${idOf(4)}.jpg`, new Uint8Array([1])), bad);
  await assert.rejects(driver.read("private/../../etc/passwd"), bad);
  await assert.rejects(driver.delete("C:\\Windows\\win.ini"), bad);
  await assert.rejects(driver.exists("/etc/passwd"), bad);
  assert.deepEqual((await readdir(root)).sort(), ["private", "public", "tmp"]);
});

test("put paralel ke kunci berbeda tidak saling ganggu", async () => {
  const keys = Array.from({ length: 12 }, (_, i) => `private/payment-proof/2026/10/${idOf(20 + i)}.jpg`);
  await Promise.all(keys.map((k, i) => driver.put(k, new Uint8Array([i]))));
  for (const [i, k] of keys.entries()) assert.deepEqual([...(await driver.read(k))], [i]);
  assert.deepEqual(await readdir(path.join(root, "tmp")), []);
});
