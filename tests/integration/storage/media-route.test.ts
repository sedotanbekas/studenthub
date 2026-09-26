import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { GET } from "@/app/media/[...key]/route";
import { getStorage, setStorageDriver } from "@/lib/storage/driver";
import { createTempStorage, type TempStorage } from "../helpers/storage";

/** Route cadangan /media/*: hanya salinan publik banner; selain itu 404 tanpa menyentuh berkas lain. */
let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
});
after(async () => {
  setStorageDriver(null);
  await storage.cleanup();
});

const ID = "AbCdEfGhIjKlMnOpQrStUv";
const call = (segments: string[]) => GET(new Request(`http://localhost/media/${segments.join("/")}`), { params: Promise.resolve({ key: segments }) });

test("banner publik yang ada dilayani dengan tipe webp & cache panjang", async () => {
  const bytes = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]);
  await getStorage().put(`public/ad-banner/2026/09/${ID}.webp`, bytes);
  const res = await call(["ad-banner", "2026", "09", `${ID}.webp`]);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.match(res.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), bytes);
});

test("berkas privat tidak pernah bisa dibuka lewat /media (walau ada di disk)", async () => {
  await getStorage().put(`private/ad-banner/2026/09/${ID}.webp`, new Uint8Array([1, 2, 3]));
  await getStorage().put(`private/attendance-selfie/2026/09/${ID}.jpg`, new Uint8Array([1, 2, 3]));
  assert.equal((await call(["..", "private", "ad-banner", "2026", "09", `${ID}.webp`])).status, 404);
  assert.equal((await call(["attendance-selfie", "2026", "09", `${ID}.jpg`])).status, 404);
});

test("banner publik yang tidak ada -> 404", async () => {
  const res = await call(["ad-banner", "2026", "10", `${ID}.webp`]);
  assert.equal(res.status, 404);
});
