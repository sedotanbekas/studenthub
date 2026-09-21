import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { makePrincipal } from "@/lib/auth/test-principal";
import { setStorageDriver } from "@/lib/storage/driver";
import { discardFile, openFileForViewer, persistProcessedFile, publishBannerCopy, unpublishBannerCopy } from "@/lib/storage/files";
import { processImage } from "@/lib/storage/image";
import { withTx } from "@/lib/tx";
import { disconnect, prisma } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSponsor, createStudent } from "../helpers/factories";
import { createTempStorage, type TempStorage } from "../helpers/storage";

let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const photo = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 100, b: 50 } } }).jpeg().toBuffer();

async function readAll(stream: ReadableStream<Uint8Array>): Promise<number> {
  let total = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) total += chunk.length;
  return total;
}

test("simpan selfie privat lalu hanya pemilik & admin sekolah yang bisa membuka", async () => {
  const school = await createSchool();
  const other = await createSchool();
  const st = await createStudent(school.id);
  const processed = await processImage(await photo(800, 1000), "ATTENDANCE_SELFIE");
  const saved = await withTx((tx) =>
    persistProcessedFile(tx, { kind: "ATTENDANCE_SELFIE", processed, uploadedById: st.user.id, schoolId: school.id, bucket: "private", attachedAt: new Date() }, new Date()),
  );
  assert.match(saved.storageKey, /^private\/attendance-selfie\//);
  const owner = makePrincipal({ userId: st.user.id, role: "STUDENT", schoolId: school.id, studentId: st.student.id, studentStatus: "ACTIVE" });
  const download = await openFileForViewer(saved.id, owner);
  assert.equal(await readAll(download.body), download.size);
  const admin = await createSchoolAdmin(school.id);
  await openFileForViewer(saved.id, makePrincipal({ userId: admin.id, schoolId: school.id }));
  const foreignAdmin = await createSchoolAdmin(other.id);
  await assert.rejects(openFileForViewer(saved.id, makePrincipal({ userId: foreignAdmin.id, schoolId: other.id })), { status: 404 });
  await prisma.storedFile.update({ where: { id: saved.id }, data: { deletedAt: new Date() } });
  await assert.rejects(openFileForViewer(saved.id, owner), { status: 410 });
  await assert.rejects(openFileForViewer("tidak-ada", owner), { status: 404 });
  await discardFile(saved.storageKey);
  await discardFile(saved.storageKey);
});

test("salinan publik banner dibuat & dihapus", async () => {
  const sp = await createSponsor();
  const processed = await processImage(await photo(1200, 600), "AD_BANNER");
  const saved = await withTx((tx) =>
    persistProcessedFile(tx, { kind: "AD_BANNER", processed, uploadedById: sp.user.id, sponsorId: sp.sponsor.id, bucket: "private", attachedAt: null }, new Date()),
  );
  const publicKey = await publishBannerCopy(saved.storageKey);
  assert.match(publicKey, /^public\/ad-banner\//);
  assert.equal(await unpublishBannerCopy(saved.storageKey), true);
  assert.equal(await unpublishBannerCopy(saved.storageKey), false);
});
