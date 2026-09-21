import type { UserRole } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import { hashPassword } from "@/lib/auth/password";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import { revokeAllSessions } from "@/lib/auth/sessions";
import { prisma, type Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import { superAdminsLockKey, userLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import { getUserDto, USER_NOT_FOUND_MESSAGE } from "./queries";
import {
  assertCreatableRole,
  assertEditableTarget,
  assertNotLastSuperAdmin,
  assertResetTarget,
  assertSessionTarget,
  assertStatusTarget,
  planCredential,
} from "./rules";
import type { CreateUserInput, PlatformUserDto, UpdateUserInput } from "./schemas";

/**
 * Kunci aplikasi (src/lib/lock-keys.ts): mutasi yang menyentuh kredensial/sesi/status akun mengambil
 * `userLockKey` PALING AWAL (sama dengan login & ganti kata sandi) agar login yang sedang membuat sesi
 * selesai dulu lalu ikut dicabut; penonaktifan mengambil `superAdminsLockKey` lebih dulu (kasar -> halus).
 */
type TargetRow = { id: string; role: UserRole; isActive: boolean; email: string | null; name: string; schoolId: string | null };

async function loadTarget(db: Tx, userId: string): Promise<TargetRow> {
  const target = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, email: true, name: true, schoolId: true },
  });
  if (!target) throw notFound(USER_NOT_FOUND_MESSAGE);
  return target;
}

const emailTaken = () => conflict("EMAIL_TAKEN", "Email sudah dipakai akun lain.");

async function assertEmailFree(db: Tx, email: string, exceptUserId?: string): Promise<void> {
  const holder = await db.user.findFirst({ where: { email, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true } });
  if (holder) throw emailTaken();
}

/** P2002 pada User saat create/ubah email = email bentrok (balapan dua request). */
function mapEmailRace(error: unknown): never {
  if ((error as { code?: unknown } | null)?.code === "P2002") throw emailTaken();
  throw error;
}

async function assertSchoolUsable(tx: Tx, schoolId: string): Promise<void> {
  const school = await tx.school.findUnique({ where: { id: schoolId }, select: { isActive: true } });
  if (!school) throw notFound("Sekolah tidak ditemukan.");
  if (!school.isActive) throw conflict("SCHOOL_INACTIVE", "Sekolah nonaktif; aktifkan sekolah terlebih dahulu.");
}

/**
 * Buat akun SCHOOL_ADMIN/SUPER_ADMIN. Kata sandi awal diketik (lolos kebijakan) atau di-generate
 * (dikembalikan SEKALI). Akun baru selalu wajib ganti kata sandi saat login pertama.
 */
export async function createUser(input: CreateUserInput, ctx: ActionContext): Promise<{ user: PlatformUserDto; temporaryPassword?: string }> {
  assertCreatableRole(input.role, input.schoolId);
  const plan = planCredential(input.initialPassword, { email: input.email }, ctx.now);
  await assertEmailFree(prisma, input.email);
  const passwordHash = await hashPassword(plan.plain, plan.cost);
  const schoolId = input.role === "SCHOOL_ADMIN" ? (input.schoolId ?? null) : null;
  const userId = await withTx(async (tx) => {
    if (schoolId) await assertSchoolUsable(tx, schoolId);
    const created = await tx.user.create({
      data: { role: input.role, name: input.name, email: input.email, schoolId, passwordHash, mustChangePassword: true, tempPasswordExpiresAt: plan.tempPasswordExpiresAt },
      select: { id: true },
    });
    const after = { role: input.role, name: input.name, email: input.email, schoolId, credential: plan.kind };
    await writeAudit(tx, { action: "user.create", entityType: "User", entityId: created.id, schoolId, after }, ctx);
    return created.id;
  }).catch(mapEmailRace);
  const user = await getUserDto(userId);
  return plan.kind === "GENERATED" ? { user, temporaryPassword: plan.plain } : { user };
}

/** Ubah nama/email saja (peran, sekolah, sponsor tidak pernah berubah). */
export async function updateUser(userId: string, patch: UpdateUserInput, ctx: ActionContext): Promise<PlatformUserDto> {
  await withTx(async (tx) => {
    const target = await loadTarget(tx, userId);
    assertEditableTarget(target);
    const changes = {
      ...(patch.name !== undefined && patch.name !== target.name ? { name: patch.name } : {}),
      ...(patch.email !== undefined && patch.email !== target.email?.toLowerCase() ? { email: patch.email } : {}),
    };
    if (Object.keys(changes).length === 0) return;
    if (changes.email) await assertEmailFree(tx, changes.email, userId);
    await tx.user.update({ where: { id: userId }, data: changes });
    const before = Object.fromEntries(Object.keys(changes).map((key) => [key, target[key as keyof typeof changes]]));
    await writeAudit(tx, { action: "user.update", entityType: "User", entityId: userId, schoolId: target.schoolId, before, after: changes }, ctx);
  }).catch(mapEmailRace);
  return getUserDto(userId);
}

type DeactivateResult = { id: string; isActive: boolean; revokedSessions: number };

/**
 * Isi transaksi penonaktifan. Kunci 'super-admins' lalu kunci user diambil PERTAMA (sebelum baca apa pun)
 * agar hitungan super admin aktif selalu segar dan login yang sedang berjalan selesai sebelum sesi dicabut.
 */
export async function deactivateUserTx(tx: Tx, userId: string, reason: string, ctx: ActionContext): Promise<DeactivateResult> {
  const actor = requirePrincipal(ctx);
  await lockKey(tx, superAdminsLockKey());
  await lockKey(tx, userLockKey(userId));
  const target = await loadTarget(tx, userId);
  assertStatusTarget(actor.userId, target);
  if (target.role === "SUPER_ADMIN") {
    const others = await tx.user.count({ where: { role: "SUPER_ADMIN", isActive: true, id: { not: userId } } });
    assertNotLastSuperAdmin(target, others);
  }
  const updated = await tx.user.updateMany({ where: { id: userId, isActive: true }, data: { isActive: false } });
  if (updated.count === 0) throw conflict("USER_ALREADY_INACTIVE", "Akun sudah nonaktif.");
  const revokedSessions = await revokeAllSessions(tx, userId, "ACCOUNT_DISABLED", ctx.now);
  const after = { isActive: false, reason, revokedSessions };
  await writeAudit(tx, { action: "user.deactivate", entityType: "User", entityId: userId, schoolId: target.schoolId, before: { isActive: true }, after }, ctx);
  return { id: userId, isActive: false, revokedSessions };
}

/** Nonaktifkan akun non-siswa: semua sesi dicabut (401 pada request berikutnya). */
export async function deactivateUser(userId: string, reason: string, ctx: ActionContext): Promise<DeactivateResult> {
  return withTx((tx) => deactivateUserTx(tx, userId, reason, ctx));
}

/** Aktifkan kembali akun non-siswa; pengguna harus login ulang. */
export async function activateUser(userId: string, ctx: ActionContext): Promise<{ id: string; isActive: boolean }> {
  const actor = requirePrincipal(ctx);
  return withTx(async (tx) => {
    const target = await loadTarget(tx, userId);
    assertStatusTarget(actor.userId, target);
    const updated = await tx.user.updateMany({ where: { id: userId, isActive: false }, data: { isActive: true } });
    if (updated.count === 0) throw conflict("USER_ALREADY_ACTIVE", "Akun sudah aktif.");
    await writeAudit(
      tx,
      { action: "user.activate", entityType: "User", entityId: userId, schoolId: target.schoolId, before: { isActive: false }, after: { isActive: true } },
      ctx,
    );
    return { id: userId, isActive: true };
  });
}

/** Paksa logout seluruh perangkat pengguna lain. */
export async function revokeUserSessions(userId: string, ctx: ActionContext): Promise<{ revokedCount: number }> {
  const actor = requirePrincipal(ctx);
  return withTx(async (tx) => {
    await lockKey(tx, userLockKey(userId));
    const target = await loadTarget(tx, userId);
    assertSessionTarget(actor.userId, target);
    const revokedCount = await revokeAllSessions(tx, userId, "ADMIN_REVOKED", ctx.now);
    await writeAudit(tx, { action: "user.revoke_sessions", entityType: "User", entityId: userId, schoolId: target.schoolId, after: { revokedCount } }, ctx);
    return { revokedCount };
  });
}

/**
 * Reset kata sandi akun non-siswa (bukan diri sendiri). Audit TIDAK pernah memuat kata sandi;
 * kata sandi hanya dikembalikan bila dibuat sistem.
 */
export async function resetUserPassword(
  userId: string,
  newPassword: string | undefined,
  ctx: ActionContext,
): Promise<{ mustChangePassword: true; temporaryPassword?: string }> {
  const actor = requirePrincipal(ctx);
  const target = await loadTarget(prisma, userId);
  assertResetTarget(actor.userId, target);
  const plan = planCredential(newPassword, { email: target.email }, ctx.now);
  const passwordHash = await hashPassword(plan.plain, plan.cost);
  await withTx(async (tx) => {
    // Kunci user PERTAMA: ganti kata sandi/login yang sedang berjalan selesai dulu, lalu tertimpa & dicabut.
    await lockKey(tx, userLockKey(userId));
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: true, passwordChangedAt: ctx.now, tempPasswordExpiresAt: plan.tempPasswordExpiresAt },
    });
    const revokedSessions = await revokeAllSessions(tx, userId, "ADMIN_REVOKED", ctx.now);
    const after = { credential: plan.kind, revokedSessions };
    await writeAudit(tx, { action: "user.reset_password", entityType: "User", entityId: userId, schoolId: target.schoolId, after }, ctx);
  });
  return plan.kind === "GENERATED" ? { mustChangePassword: true, temporaryPassword: plan.plain } : { mustChangePassword: true };
}
