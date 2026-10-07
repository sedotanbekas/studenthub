import type { UserRole } from "@prisma/client";
import type { Action } from "@/lib/auth/policy";
import { writeAudit } from "@/lib/audit";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { conflict, notFound } from "@/lib/http/errors";
import { accessRolesLockKey, userLockKey } from "@/lib/lock-keys";
import { lockKey, withTx } from "@/lib/tx";
import { getAccessRole, loadRole } from "./queries";
import {
  ALL_ACTIONS,
  assertDeletable,
  assertNotSelfLockout,
  assertRoleMatchesAccount,
  normalizePermissions,
  resolveGrants,
  roleKeyFromName,
} from "./rules";
import type { AccessRoleDetailDto, CreateAccessRoleInput, UpdateAccessRoleInput } from "./schemas";
import { invalidateSystemRoles } from "./system-roles";

/**
 * Mutasi peran akses RBAC (2026-10-07). Semua di bawah kunci `accessRolesLockKey` (diambil paling awal) dan
 * diaudit di transaksi yang sama. Hak berlaku seketika: getAuth menghitung hak dari peran di setiap request.
 */

/** Peran yang sedang dipakai aktor (peran terpasang, atau peran sistem jenis akunnya). */
async function actorRoleId(tx: Tx, userId: string): Promise<string | null> {
  const actor = await tx.user.findUnique({ where: { id: userId }, select: { accessRoleId: true, role: true } });
  if (!actor) return null;
  if (actor.accessRoleId) return actor.accessRoleId;
  const system = await tx.accessRole.findFirst({ where: { isSystem: true, baseRole: actor.role }, select: { id: true } });
  return system?.id ?? null;
}

async function uniqueKey(tx: Tx, name: string): Promise<string> {
  const base = roleKeyFromName(name);
  for (let n = 1; n <= 50; n++) {
    const key = n === 1 ? base : `${base}-${n}`;
    if (!(await tx.accessRole.findUnique({ where: { key }, select: { id: true } }))) return key;
  }
  throw conflict("ROLE_KEY_TAKEN", "Nama peran sudah dipakai. Gunakan nama lain.");
}

async function seedPermissions(tx: Tx, input: CreateAccessRoleInput): Promise<string[]> {
  if (input.permissions) return input.permissions;
  if (!input.copyFromId) return [];
  const source = await loadRole(tx, input.copyFromId);
  assertRoleMatchesAccount(source.baseRole, input.baseRole);
  return [...resolveGrants(source, source.baseRole)];
}

export async function createAccessRole(input: CreateAccessRoleInput, ctx: ActionContext): Promise<AccessRoleDetailDto> {
  const principal = requirePrincipal(ctx);
  const id = await withTx(async (tx) => {
    await lockKey(tx, accessRolesLockKey());
    const permissions = normalizePermissions(input.baseRole, false, await seedPermissions(tx, input));
    const key = await uniqueKey(tx, input.name);
    const data = { key, name: input.name, description: input.description || null, baseRole: input.baseRole, isSystem: false, permissions, knownActions: ALL_ACTIONS };
    const created = await tx.accessRole.create({ data, select: { id: true } });
    await writeAudit(tx, { action: "role.create", entityType: "AccessRole", entityId: created.id, after: { key, name: input.name, baseRole: input.baseRole, permissions } }, ctx);
    return created.id;
  });
  return getAccessRole(principal, id);
}

export async function updateAccessRole(id: string, input: UpdateAccessRoleInput, ctx: ActionContext): Promise<AccessRoleDetailDto> {
  const principal = requirePrincipal(ctx);
  await withTx(async (tx) => {
    await lockKey(tx, accessRolesLockKey());
    const role = await loadRole(tx, id);
    const permissions = input.permissions ? normalizePermissions(role.baseRole, role.isSystem, input.permissions) : undefined;
    if (permissions) {
      const grants = resolveGrants({ isSystem: role.isSystem, permissions, knownActions: ALL_ACTIONS }, role.baseRole);
      assertNotSelfLockout(grants, (await actorRoleId(tx, principal.userId)) === role.id);
    }
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description || null } : {}),
      ...(permissions ? { permissions, knownActions: ALL_ACTIONS } : {}),
    };
    await tx.accessRole.update({ where: { id }, data });
    const before = { name: role.name, description: role.description, permissions: [...resolveGrants(role, role.baseRole)] };
    await writeAudit(tx, { action: "role.update", entityType: "AccessRole", entityId: id, before, after: data }, ctx);
  });
  invalidateSystemRoles();
  return getAccessRole(principal, id);
}

/** Hapus peran buatan; akun pemakainya kembali ke peran sistem jenis akunnya (FK ON DELETE SET NULL). */
export async function deleteAccessRole(id: string, ctx: ActionContext): Promise<{ id: string; usersReset: number }> {
  const principal = requirePrincipal(ctx);
  return withTx(async (tx) => {
    await lockKey(tx, accessRolesLockKey());
    const role = await loadRole(tx, id);
    assertDeletable(role);
    if ((await actorRoleId(tx, principal.userId)) === role.id) {
      throw conflict("ROLE_IN_USE_BY_YOU", "Peran ini sedang Anda pakai. Pasang peran lain ke akun Anda dulu.");
    }
    const usersReset = await tx.user.count({ where: { accessRoleId: id } });
    await tx.accessRole.delete({ where: { id } });
    await writeAudit(tx, { action: "role.delete", entityType: "AccessRole", entityId: id, before: { key: role.key, name: role.name, usersReset } }, ctx);
    return { id, usersReset };
  });
}

export interface AssignTarget {
  readonly userId: string;
  /** Hanya akun sekolah ini (endpoint admin sekolah); null = super admin (akun mana pun). */
  readonly schoolId: string | null;
}

/** Pasang peran ke akun (null = kembali ke peran sistem). Peran wajib berjenis akun sama. */
export async function assignAccessRole(target: AssignTarget, accessRoleId: string | null, ctx: ActionContext): Promise<{ accessRole: { id: string; name: string; isSystem: boolean } | null }> {
  const principal = requirePrincipal(ctx);
  return withTx(async (tx) => {
    await lockKey(tx, accessRolesLockKey());
    await lockKey(tx, userLockKey(target.userId));
    const user = await tx.user.findFirst({
      where: { id: target.userId, ...(target.schoolId ? { schoolId: target.schoolId } : {}) },
      select: { id: true, role: true, accessRoleId: true, schoolId: true },
    });
    if (!user) throw notFound("Akun tidak ditemukan.");
    const role = accessRoleId ? await loadRole(tx, accessRoleId) : null;
    if (role) assertRoleMatchesAccount(role.baseRole, user.role);
    await assertAssignKeepsActor(tx, principal.userId, user, role);
    // Peran sistem dipasang = sama dengan tanpa peran (NULL): akun ikut perubahan peran sistem.
    const stored = role && !role.isSystem ? role.id : null;
    await tx.user.update({ where: { id: user.id }, data: { accessRoleId: stored } });
    await writeAudit(tx, { action: "user.access_role", entityType: "User", entityId: user.id, schoolId: user.schoolId, before: { accessRoleId: user.accessRoleId }, after: { accessRoleId: stored } }, ctx);
    return { accessRole: role ? { id: role.id, name: role.name, isSystem: role.isSystem } : null };
  });
}

async function assertAssignKeepsActor(tx: Tx, actorId: string, user: { id: string; role: UserRole }, role: Awaited<ReturnType<typeof loadRole>> | null): Promise<void> {
  if (user.id !== actorId) return;
  const source = role ?? (await tx.accessRole.findFirst({ where: { isSystem: true, baseRole: user.role } }));
  const grants = source ? resolveGrants(source, user.role) : new Set<Action>(["roles.manage"]);
  assertNotSelfLockout(grants, true);
}
