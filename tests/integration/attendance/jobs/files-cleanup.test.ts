import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { runOrphanFilesCleanup } from "@/lib/jobs/files-cleanup";
import { getStorage, setStorageDriver } from "@/lib/storage/driver";
import { persistProcessedFile, publishBannerCopy } from "@/lib/storage/files";
import { processImage } from "@/lib/storage/image";
import { publicKeyFor } from "@/lib/storage/keys";
import { withTx } from "@/lib/tx";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createSponsor } from "../../helpers/factories";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { jobCtx } from "./fixtures";

const HOUR_MS = 3_600_000;
const NOW = new Date();
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR_MS);

let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const bannerBytes = () => sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 30, g: 160, b: 90 } } }).png().toBuffer();

async function banner(uploadedById: string, sponsorId: string, createdAt: Date, attachedAt: Date | null = null) {
  const processed = await processImage(await bannerBytes(), "AD_BANNER");
  return withTx((tx) => persistProcessedFile(tx, { kind: "AD_BANNER", processed, uploadedById, sponsorId, bucket: "private", attachedAt }, createdAt));
}

test("banner yatim > 24 jam: byte (termasuk salinan publik) lalu baris dihapus; banner lain tetap", async () => {
  const { sponsor, user } = await createSponsor();
  const orphan = await banner(user.id, sponsor.id, new Date(NOW.getTime() - 25 * HOUR_MS));
  await publishBannerCopy(orphan.storageKey);
  const fresh = await banner(user.id, sponsor.id, hoursAgo(23));
  const attached = await banner(user.id, sponsor.id, hoursAgo(48), hoursAgo(47));
  const referenced = await banner(user.id, sponsor.id, hoursAgo(48));
  await prisma.ad.create({
    data: {
      sponsorId: sponsor.id,
      title: "Iklan uji",
      imageFileId: referenced.id,
      targetUrl: "https://contoh.id",
      linkType: "EXTERNAL_URL",
      startAt: NOW,
      endAt: new Date(NOW.getTime() + 24 * HOUR_MS),
      cpcAmount: 500,
    },
  });

  const result = await runOrphanFilesCleanup(jobCtx(NOW, { userIds: [user.id] }));
  assert.deepEqual(result, { deleted: 1, failed: 0 });
  assert.equal(await prisma.storedFile.count({ where: { id: orphan.id } }), 0);
  assert.equal(await getStorage().exists(orphan.storageKey), false);
  assert.equal(await getStorage().exists(publicKeyFor(orphan.storageKey)), false);
  for (const kept of [fresh, attached, referenced]) {
    assert.equal(await prisma.storedFile.count({ where: { id: kept.id } }), 1, kept.id);
    assert.equal(await getStorage().exists(kept.storageKey), true, kept.id);
  }
  assert.deepEqual(await runOrphanFilesCleanup(jobCtx(NOW, { userIds: [user.id] })), { deleted: 0, failed: 0 });
});

test("byte gagal dihapus -> baris dipertahankan dan dilaporkan failed", async () => {
  const { sponsor, user } = await createSponsor();
  const orphan = await banner(user.id, sponsor.id, hoursAgo(30));
  await prisma.storedFile.update({ where: { id: orphan.id }, data: { storageKey: `private/tidak-valid/${uniq("f")}.webp` } });
  const result = await runOrphanFilesCleanup(jobCtx(NOW, { userIds: [user.id] }));
  assert.deepEqual(result, { deleted: 0, failed: 1 });
  assert.equal(await prisma.storedFile.count({ where: { id: orphan.id } }), 1);
  await prisma.storedFile.delete({ where: { id: orphan.id } });
});

test("scope tanpa userIds tidak menyentuh apa pun", async () => {
  assert.deepEqual(await runOrphanFilesCleanup(jobCtx(NOW, { schoolIds: [] })), { deleted: 0, failed: 0 });
});
