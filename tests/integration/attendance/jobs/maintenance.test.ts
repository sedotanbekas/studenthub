import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import type { FileKind } from "@prisma/client";
import { AUTO_ALPHA_JOB } from "@/lib/attendance/auto-alpha-rules";
import { makePrincipal } from "@/lib/auth/test-principal";
import { runMaintenanceDaily } from "@/lib/jobs/maintenance";
import { getStorage, setStorageDriver } from "@/lib/storage/driver";
import { openFileForViewer, persistProcessedFile } from "@/lib/storage/files";
import { processImage } from "@/lib/storage/image";
import { toDbDate } from "@/lib/time/zone";
import { withTx } from "@/lib/tx";
import { disconnect, prisma, uniq } from "../../helpers/db";
import { createSchool, createSchoolAdmin, createStudent } from "../../helpers/factories";
import { createTempStorage, type TempStorage } from "../../helpers/storage";
import { jobCtx } from "./fixtures";

const DAY_MS = 86_400_000;
const NOW = new Date();
const daysAgo = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

let storage: TempStorage;
before(async () => {
  storage = await createTempStorage();
  setStorageDriver(null);
});
after(async () => {
  await storage.cleanup();
  await disconnect();
});

const photo = () => sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: 90, g: 140, b: 200 } } }).jpeg().toBuffer();

async function storeFile(kind: FileKind, uploadedById: string, schoolId: string | null, createdAt: Date) {
  const processed = await processImage(await photo(), kind);
  const saved = await withTx((tx) => persistProcessedFile(tx, { kind, processed, uploadedById, schoolId, bucket: "private", attachedAt: createdAt }, createdAt));
  return saved;
}

test("selfie > 180 hari: byte dihapus, deletedAt diisi, baris absensi tetap, unduhan 410; selfie baru tetap", async () => {
  const school = await createSchool();
  const st = await createStudent(school.id);
  const admin = await createSchoolAdmin(school.id);
  const oldSelfie = await storeFile("ATTENDANCE_SELFIE", st.user.id, school.id, daysAgo(181));
  const freshSelfie = await storeFile("ATTENDANCE_SELFIE", st.user.id, school.id, daysAgo(179));
  const oldProof = await storeFile("PAYMENT_PROOF", st.user.id, school.id, daysAgo(400));
  const attendance = await prisma.attendance.create({
    data: {
      schoolId: school.id, studentId: st.student.id, date: toDbDate("2026-03-20"), status: "HADIR", source: "CHECKIN",
      checkInAt: daysAgo(181), latitude: "-6.9", longitude: "107.6", selfieFileId: oldSelfie.id,
    },
  });

  const result = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [school.id], userIds: [] }));
  assert.deepEqual(result.selfies, { purged: 1, failed: 0 });
  assert.equal(await getStorage().exists(oldSelfie.storageKey), false);
  assert.equal(await getStorage().exists(freshSelfie.storageKey), true);
  assert.equal(await getStorage().exists(oldProof.storageKey), true, "hanya selfie yang terkena retensi");
  const purged = await prisma.storedFile.findFirstOrThrow({ where: { id: oldSelfie.id } });
  assert.ok(purged.deletedAt);
  assert.equal((await prisma.attendance.findFirstOrThrow({ where: { id: attendance.id } })).selfieFileId, oldSelfie.id);
  await assert.rejects(openFileForViewer(oldSelfie.id, makePrincipal({ userId: admin.id, schoolId: school.id })), { status: 410, code: "FILE_PURGED" });

  const again = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [school.id], userIds: [] }));
  assert.deepEqual(again.selfies, { purged: 0, failed: 0 });
});

test("lampiran izin: CANCELLED dibersihkan, REJECTED > 30 hari dibersihkan; REJECTED baru, PENDING & APPROVED tetap", async () => {
  const school = await createSchool();
  const st = await createStudent(school.id);
  const leaveWith = async (status: "CANCELLED" | "REJECTED" | "PENDING" | "APPROVED", reviewedAt: Date | null) => {
    const file = await storeFile("LEAVE_ATTACHMENT", st.user.id, school.id, daysAgo(40));
    await prisma.leaveRequest.create({
      data: {
        schoolId: school.id, studentId: st.student.id, type: "SAKIT", reason: "Uji retensi lampiran", status, reviewedAt,
        startDate: toDbDate("2026-05-04"), endDate: toDbDate("2026-05-05"), attachmentFileId: file.id,
      },
    });
    return file;
  };
  const cancelled = await leaveWith("CANCELLED", null);
  const rejectedOld = await leaveWith("REJECTED", daysAgo(31));
  const rejectedRecent = await leaveWith("REJECTED", daysAgo(29));
  const pending = await leaveWith("PENDING", null);
  const approved = await leaveWith("APPROVED", daysAgo(200));

  const result = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [school.id], userIds: [] }));
  assert.deepEqual(result.leaveAttachments, { purged: 2, failed: 0 });
  for (const file of [cancelled, rejectedOld]) {
    assert.equal(await getStorage().exists(file.storageKey), false);
    assert.ok((await prisma.storedFile.findFirstOrThrow({ where: { id: file.id } })).deletedAt);
  }
  for (const file of [rejectedRecent, pending, approved]) {
    assert.equal(await getStorage().exists(file.storageKey), true);
    assert.equal((await prisma.storedFile.findFirstOrThrow({ where: { id: file.id } })).deletedAt, null);
  }
  const again = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [school.id], userIds: [] }));
  assert.deepEqual(again.leaveAttachments, { purged: 0, failed: 0 });
});

test("CheckInRejection > 90 hari dihapus, yang lebih baru tetap", async () => {
  const school = await createSchool();
  const st = await createStudent(school.id);
  const row = (createdAt: Date) =>
    prisma.checkInRejection.create({ data: { schoolId: school.id, studentId: st.student.id, date: toDbDate("2026-06-01"), reason: "OUTSIDE_GEOFENCE", createdAt } });
  const old = await row(daysAgo(91));
  const recent = await row(daysAgo(89));
  const result = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [school.id], userIds: [] }));
  assert.deepEqual(result.checkInRejections, { deleted: 1 });
  assert.equal(await prisma.checkInRejection.count({ where: { id: old.id } }), 0);
  assert.equal(await prisma.checkInRejection.count({ where: { id: recent.id } }), 1);
});

test("token & sesi mati: sesi dicabut > 90 hari (kaskade token) dan token ditukar > 30 hari / kedaluwarsa > 1 hari", async () => {
  const school = await createSchool();
  const st = await createStudent(school.id);
  const session = (data: { revokedAt?: Date; expiresAt: Date }) => prisma.authSession.create({ data: { userId: st.user.id, platform: "ANDROID", deviceId: uniq("d"), ...data } });
  const token = (sessionId: string, data: { rotatedAt?: Date; expiresAt: Date }) =>
    prisma.refreshToken.create({ data: { sessionId, tokenHash: uniq("h").padEnd(64, "0").slice(0, 64), ...data } });
  const dead = await session({ revokedAt: daysAgo(91), expiresAt: daysAgo(10) });
  await session({ expiresAt: daysAgo(95) });
  const live = await session({ expiresAt: new Date(NOW.getTime() + 30 * DAY_MS) });
  const deadToken = await token(dead.id, { expiresAt: daysAgo(10) });
  const rotatedOld = await token(live.id, { rotatedAt: daysAgo(31), expiresAt: new Date(NOW.getTime() + DAY_MS) });
  const rotatedRecent = await token(live.id, { rotatedAt: daysAgo(29), expiresAt: new Date(NOW.getTime() + DAY_MS) });
  const expired = await token(live.id, { expiresAt: daysAgo(2) });
  const current = await token(live.id, { expiresAt: new Date(NOW.getTime() + DAY_MS) });

  const result = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [], userIds: [st.user.id] }));
  assert.deepEqual(result.auth, { refreshTokens: 2, sessions: 2 });
  assert.deepEqual((await prisma.authSession.findMany({ where: { userId: st.user.id } })).map((s) => s.id), [live.id]);
  assert.equal(await prisma.refreshToken.count({ where: { id: { in: [deadToken.id, rotatedOld.id, expired.id] } } }), 0);
  assert.equal(await prisma.refreshToken.count({ where: { id: { in: [rotatedRecent.id, current.id] } } }), 2);
});

test("notifikasi > 365 hari dihapus; JobRun > 90 hari dihapus kecuali auto-alpha (400 hari)", async () => {
  const school = await createSchool();
  const st = await createStudent(school.id);
  const note = (createdAt: Date) =>
    prisma.notification.create({ data: { userId: st.user.id, type: "ATTENDANCE_CORRECTED", category: "STUDENT_AFFAIRS", title: "Uji", body: "Uji retensi", createdAt } });
  const oldNote = await note(daysAgo(366));
  const keptNote = await note(daysAgo(364));
  const run = (job: string, runKey: string, startedAt: Date) => prisma.jobRun.create({ data: { job, scopeKey: school.id, runKey, status: "SUCCEEDED", startedAt } });
  await run("uji-maintenance", "k1", daysAgo(91));
  const recentGeneric = await run("uji-maintenance", "k2", daysAgo(89));
  const keptAlpha = await run(AUTO_ALPHA_JOB, "2026-01-01", daysAgo(200));
  await run(AUTO_ALPHA_JOB, "2025-01-01", daysAgo(401));

  const result = await runMaintenanceDaily(jobCtx(NOW, { schoolIds: [school.id], userIds: [st.user.id] }));
  assert.deepEqual(result.notifications, { deleted: 1 });
  assert.deepEqual(result.jobRuns, { deleted: 2 });
  assert.deepEqual(await prisma.notification.count({ where: { id: { in: [oldNote.id, keptNote.id] } } }), 1);
  const remaining = (await prisma.jobRun.findMany({ where: { scopeKey: school.id }, select: { id: true } })).map((r) => r.id).sort();
  assert.deepEqual(remaining, [recentGeneric.id, keptAlpha.id].sort());
});

interface ExplainRow {
  readonly type: string;
  readonly key: string | null;
}

test("query retensi tabel besar memakai indeks (EXPLAIN bukan type=ALL / tanpa key)", async () => {
  const cutoff = daysAgo(365);
  const plans: ExplainRow[][] = [
    await prisma.$queryRaw`EXPLAIN SELECT id FROM Notification WHERE createdAt < ${cutoff} ORDER BY createdAt ASC LIMIT 5000`,
    await prisma.$queryRaw`EXPLAIN SELECT id FROM AuthSession WHERE revokedAt < ${cutoff} LIMIT 5000`,
    await prisma.$queryRaw`EXPLAIN SELECT id FROM AuthSession WHERE expiresAt < ${cutoff} LIMIT 5000`,
    await prisma.$queryRaw`EXPLAIN DELETE FROM CheckInRejection WHERE createdAt < ${cutoff} LIMIT 5000`,
    await prisma.$queryRaw`EXPLAIN SELECT id FROM JobRun WHERE job = ${AUTO_ALPHA_JOB} AND startedAt < ${cutoff} LIMIT 5000`,
  ];
  for (const [plan] of plans) {
    const label = `type=${String(plan?.type)} key=${String(plan?.key)}`;
    assert.notEqual(plan?.type, "ALL", label);
    assert.ok(plan?.key, label);
  }
});

test("anggaran waktu habis -> semua bagian dilewati", async () => {
  const result = await runMaintenanceDaily({ ...jobCtx(NOW, { schoolIds: [], userIds: [] }), deadline: Date.now() - 1 });
  assert.deepEqual(result, { skipped: ["selfies", "leaveAttachments", "checkInRejections", "auth", "notifications", "jobRuns"] });
});
