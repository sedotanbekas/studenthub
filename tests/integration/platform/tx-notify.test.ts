import { after, test } from "node:test";
import assert from "node:assert/strict";
import { writeAudit } from "@/lib/audit";
import { revokeAllSessions, revokeSchoolSessions, revokeSession } from "@/lib/auth/sessions";
import { notifySchoolAdmins, notifySponsorMembers, notifyStudents, notifySuperAdmins, notifyUsers } from "@/lib/notifications/notify";
import { lockKey, lockRows, withTx } from "@/lib/tx";
import { createSessionToken } from "../helpers/auth";
import { disconnect, prisma, uniq } from "../helpers/db";
import { createSchool, createSchoolAdmin, createSponsor, createStudent, createSuperAdmin } from "../helpers/factories";

after(disconnect);
const NOW = new Date();

test("withTx meng-commit, dan rollback saat melempar", async () => {
  const key = `tx:${uniq()}`;
  await withTx(async (tx) => {
    await tx.appLock.create({ data: { key } });
  });
  assert.ok(await prisma.appLock.findUnique({ where: { key } }));
  const key2 = `tx:${uniq()}`;
  await assert.rejects(
    withTx(async (tx) => {
      await tx.appLock.create({ data: { key: key2 } });
      throw new Error("batal");
    }),
  );
  assert.equal(await prisma.appLock.findUnique({ where: { key: key2 } }), null);
});

test("lockKey membuat baris kunci dan lockRows mengunci id terurut", async () => {
  const school = await createSchool();
  const a = await createStudent(school.id);
  const b = await createStudent(school.id);
  const locked = await withTx(async (tx) => {
    await lockKey(tx, `grades:${uniq()}`);
    return lockRows(tx, "Student", [b.student.id, a.student.id, a.student.id]);
  });
  assert.deepEqual(locked, [a.student.id, b.student.id].sort());
  assert.deepEqual(await withTx((tx) => lockRows(tx, "Student", [])), []);
  await assert.rejects(withTx((tx) => lockKey(tx, "")));
});

test("notifikasi: siswa PENDING push, staf SKIPPED; hanya akun aktif", async () => {
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const inactiveAdmin = await createSchoolAdmin(school.id);
  await prisma.user.update({ where: { id: inactiveAdmin.id }, data: { isActive: false } });
  const st = await createStudent(school.id);
  const deferred: Array<() => Promise<void>> = [];
  const ctx = { now: NOW, defer: (t: () => Promise<void>) => deferred.push(t) };
  const event = { type: "NISN_RELEASED" as const, title: "Uji", body: "Isi   uji\n\nnotifikasi", link: { screen: "student", id: st.student.id } };
  const counts = await withTx(async (tx) => [
    await notifySchoolAdmins(tx, school.id, event, ctx),
    await notifyStudents(tx, [st.student.id], { ...event, type: "LEAVE_APPROVED" }, ctx),
    await notifyUsers(tx, [], event, ctx),
  ]);
  assert.deepEqual(counts, [1, 1, 0]);
  const adminRow = await prisma.notification.findFirstOrThrow({ where: { userId: admin.id } });
  assert.equal(adminRow.pushStatus, "SKIPPED");
  assert.equal(adminRow.body, "Isi uji notifikasi");
  assert.deepEqual(adminRow.data, { screen: "student", id: st.student.id });
  const studentRow = await prisma.notification.findFirstOrThrow({ where: { userId: st.user.id } });
  assert.equal(studentRow.pushStatus, "PENDING");
  assert.equal(studentRow.category, "STUDENT_AFFAIRS");
  assert.equal(deferred.length, 1);
  await deferred[0]?.();
});

test("notifikasi ke super admin & anggota sponsor", async () => {
  const sa = await createSuperAdmin();
  const sp = await createSponsor();
  const ctx = { now: NOW };
  await withTx(async (tx) => {
    await notifySuperAdmins(tx, { type: "TOPUP_SUBMITTED", title: "Top up", body: "Ada top up" }, ctx);
    await notifySponsorMembers(tx, sp.sponsor.id, { type: "TOPUP_APPROVED", title: "Disetujui", body: "Saldo bertambah" }, ctx);
  });
  assert.ok(await prisma.notification.findFirst({ where: { userId: sa.id, type: "TOPUP_SUBMITTED" } }));
  assert.equal((await prisma.notification.findFirstOrThrow({ where: { userId: sp.user.id } })).pushStatus, "SKIPPED");
});

test("pencabutan sesi idempoten dan membersihkan token push", async () => {
  const school = await createSchool();
  const admin = await createSchoolAdmin(school.id);
  const s1 = await createSessionToken(admin.id);
  const s2 = await createSessionToken(admin.id);
  await prisma.authSession.update({ where: { id: s1.sessionId }, data: { expoPushToken: `ExponentPushToken[${uniq()}]` } });
  assert.equal(await withTx((tx) => revokeSession(tx, s1.sessionId, "LOGOUT", NOW)), true);
  assert.equal(await withTx((tx) => revokeSession(tx, s1.sessionId, "LOGOUT", NOW)), false);
  const row = await prisma.authSession.findUniqueOrThrow({ where: { id: s1.sessionId } });
  assert.equal(row.expoPushToken, null);
  assert.equal(await withTx((tx) => revokeAllSessions(tx, admin.id, "PASSWORD_CHANGED", NOW, s2.sessionId)), 0);
  const s3 = await createSessionToken(admin.id);
  assert.equal(await withTx((tx) => revokeAllSessions(tx, admin.id, "ADMIN_REVOKED", NOW)), 2);
  await createSessionToken(admin.id);
  assert.equal(await withTx((tx) => revokeSchoolSessions(tx, school.id, "ACCOUNT_DISABLED", NOW)), 1);
  assert.ok((await prisma.authSession.findUniqueOrThrow({ where: { id: s3.sessionId } })).revokedAt);
});

test("writeAudit menyimpan aktor & meredaksi rahasia", async () => {
  const sa = await createSuperAdmin();
  const entityId = uniq();
  await withTx((tx) =>
    writeAudit(
      tx,
      { action: "uji.audit", entityType: "Uji", entityId, before: { name: "a" }, after: { name: "b", passwordHash: "x" } },
      { principal: { userId: sa.id, role: "SUPER_ADMIN" } as never, ip: "1.2.3.4", userAgent: "ua" },
    ),
  );
  const row = await prisma.auditLog.findFirstOrThrow({ where: { entityId } });
  assert.equal(row.actorId, sa.id);
  assert.deepEqual(row.after, { name: "b" });
  assert.equal(row.ipAddress, "1.2.3.4");
});
