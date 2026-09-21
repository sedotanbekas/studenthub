/**
 * Route unduhan berkas privat GET /api/v1/files/{id}: pemilik & admin sekolah yang sama 200 dengan
 * header aman, admin/siswa sekolah lain 404 (id tak bisa dienumerasi), super admin 200 tanpa schoolId,
 * sudah dihapus retensi 410 FILE_PURGED (hanya bagi yang berhak), validasi id 400, tanpa token 401.
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { GET as fileRoute } from "@/app/api/v1/files/[id]/route";
import { setStorageDriver } from "@/lib/storage/driver";
import { persistProcessedFile } from "@/lib/storage/files";
import { processImage } from "@/lib/storage/image";
import { withTx } from "@/lib/tx";
import { createSessionToken } from "../../helpers/auth";
import { disconnect, prisma } from "../../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../../helpers/factories";
import { callRoute } from "../../helpers/request";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { createSuperToken, webToken } from "./fixtures";

let storage: TempStorage;
let fileId = "";
let ownerToken = "";
let classmateToken = "";
let adminToken = "";
let foreignAdminToken = "";
let superToken = "";

before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
  const school = await createSchool();
  const other = await createSchool();
  const owner = await createStudent(school.id);
  const classmate = await createStudent(school.id);
  const selfie = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 30, g: 140, b: 90 } } }).jpeg().toBuffer();
  const processed = await processImage(selfie, "ATTENDANCE_SELFIE");
  const saved = await withTx((tx) =>
    persistProcessedFile(tx, { kind: "ATTENDANCE_SELFIE", processed, uploadedById: owner.user.id, schoolId: school.id, bucket: "private", attachedAt: new Date() }, new Date()),
  );
  fileId = saved.id;
  ownerToken = (await createSessionToken(owner.user.id)).token;
  classmateToken = (await createSessionToken(classmate.user.id, { deviceId: "device-test-0002" })).token;
  adminToken = await webToken((await createSchoolAdmin(school.id)).id);
  foreignAdminToken = await webToken((await createSchoolAdmin(other.id)).id);
  superToken = await createSuperToken();
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const download = (token: string | undefined, id = fileId, qs = "") =>
  callRoute(fileRoute, { method: "GET", url: `/api/v1/files/${encodeURIComponent(id)}${qs}`, bearer: token, params: { id } });

test("pemilik: 200 dengan byte utuh & header aman (inline; download=1 -> attachment)", async () => {
  const res = await download(ownerToken);
  assert.equal(res.status, 200);
  const bytes = new Uint8Array(await res.response.arrayBuffer());
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.equal(res.headers.get("content-length"), String(bytes.byteLength));
  assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], "JPEG hasil re-encode");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("content-security-policy"), "sandbox; default-src 'none'");
  assert.equal(res.headers.get("cache-control"), "private, max-age=300");
  assert.match(res.headers.get("content-disposition") ?? "", /^inline; filename="attendance-selfie-[A-Za-z0-9_-]+\.jpg"$/);
  assert.ok(res.headers.get("x-request-id"));
  const attachment = await download(ownerToken, fileId, "?download=1");
  assert.match(attachment.headers.get("content-disposition") ?? "", /^attachment; filename="/);
  await attachment.response.arrayBuffer();
});

test("admin sekolah yang sama & super admin 200; admin sekolah lain & siswa lain 404", async () => {
  for (const token of [adminToken, superToken]) {
    const res = await download(token);
    assert.equal(res.status, 200);
    await res.response.arrayBuffer();
  }
  for (const token of [foreignAdminToken, classmateToken]) {
    const res = await download(token);
    assert.equal(res.status, 404);
    assert.equal(res.body?.error?.code, "NOT_FOUND");
  }
  assert.equal((await download(ownerToken, "tidak-ada")).status, 404);
  assert.equal((await download(ownerToken, "x".repeat(65))).status, 400);
  assert.equal((await download(ownerToken, fileId, "?download=yes")).status, 400);
  assert.equal((await download(undefined)).status, 401);
});

test("berkas terhapus retensi: 410 FILE_PURGED bagi yang berhak, tetap 404 bagi sekolah lain", async () => {
  await prisma.storedFile.update({ where: { id: fileId }, data: { deletedAt: new Date() } });
  const purged = await download(ownerToken);
  assert.equal(purged.status, 410);
  assert.equal(purged.body?.error?.code, "FILE_PURGED");
  assert.equal((await download(adminToken)).status, 410);
  assert.equal((await download(foreignAdminToken)).status, 404);
});
