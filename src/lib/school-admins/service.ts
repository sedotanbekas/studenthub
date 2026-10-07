import type { ActionContext } from "@/lib/auth/principal";
import { replaceNotificationMutes } from "@/lib/notifications/preferences-service";
import type { UpdateNotificationPreferencesBody } from "@/lib/notifications/schemas";
import type { SchoolScope } from "@/lib/tenant/scope";
import { activateUser, createUser, deactivateUser, resetUserPassword, revokeUserSessions, updateUser } from "@/lib/users/service";
import { assignAccessRole } from "@/lib/roles/service";
import { countSchoolAdmins, getSchoolAdmin, hasPrimaryAdmin } from "./queries";
import { assertAdminQuota, assertHasPrimaryAdmin, assertManageableAdmin } from "./rules";
import type { CreateSchoolAdminInput, SchoolAdminDto, UpdateSchoolAdminInput } from "./schemas";

/**
 * Admin utama sekolah mengelola akun admin TAMBAHAN di sekolahnya (guru/wali kelas, keputusan pemilik
 * 2026-10-02). Hanya admin utama yang lolos POLICY `schoolAdmins.manage` (primarySchoolAdminOnly); super
 * admin juga boleh lewat ?schoolId=. Target selalu dicari dalam cakupan sekolah (lain -> 404) dan admin utama
 * dilindungi; sisanya memakai service akun yang sama dengan /platform/users (kunci, audit, pencabutan sesi).
 * Peran, sekolah, dan status admin utama sebuah akun tidak pernah berubah, jadi cek di luar transaksi aman.
 */
async function manageableTarget(scope: SchoolScope, id: string): Promise<SchoolAdminDto> {
  const target = await getSchoolAdmin(scope, id);
  assertManageableAdmin(target);
  return target;
}

export async function createSchoolAdmin(
  scope: SchoolScope,
  input: CreateSchoolAdminInput,
  ctx: ActionContext,
): Promise<{ admin: SchoolAdminDto; temporaryPassword?: string }> {
  // Tanpa admin utama, createUser akan menjadikan akun ini admin utama (login NPSN) — bukan tugas endpoint ini.
  assertHasPrimaryAdmin(await hasPrimaryAdmin(scope));
  assertAdminQuota(await countSchoolAdmins(scope));
  const created = await createUser(
    { role: "SCHOOL_ADMIN", name: input.name, email: input.email, schoolId: scope.schoolId, initialPassword: input.initialPassword, accessRoleId: input.accessRoleId },
    ctx,
  );
  const admin = await getSchoolAdmin(scope, created.user.id);
  return created.temporaryPassword ? { admin, temporaryPassword: created.temporaryPassword } : { admin };
}

export async function updateSchoolAdmin(scope: SchoolScope, id: string, patch: UpdateSchoolAdminInput, ctx: ActionContext): Promise<SchoolAdminDto> {
  await manageableTarget(scope, id);
  await updateUser(id, patch, ctx);
  return getSchoolAdmin(scope, id);
}

export async function deactivateSchoolAdmin(scope: SchoolScope, id: string, reason: string, ctx: ActionContext) {
  await manageableTarget(scope, id);
  return deactivateUser(id, reason, ctx);
}

export async function activateSchoolAdmin(scope: SchoolScope, id: string, ctx: ActionContext) {
  await manageableTarget(scope, id);
  return activateUser(id, ctx);
}

export async function revokeSchoolAdminSessions(scope: SchoolScope, id: string, ctx: ActionContext) {
  await manageableTarget(scope, id);
  return revokeUserSessions(id, ctx);
}

export async function resetSchoolAdminPassword(scope: SchoolScope, id: string, newPassword: string | undefined, ctx: ActionContext) {
  await manageableTarget(scope, id);
  return resetUserPassword(id, newPassword, ctx);
}

/**
 * PUT /school/admins/{id}/notification-preferences (N2): admin utama mengatur kabar sekolah akun admin TAMBAHAN.
 * Admin utama sendiri -> 403 PRIMARY_ADMIN_PROTECTED (mengatur miliknya lewat /me/notification-preferences).
 */
export async function updateSchoolAdminNotificationPreferences(scope: SchoolScope, id: string, input: UpdateNotificationPreferencesBody, ctx: ActionContext): Promise<SchoolAdminDto> {
  await manageableTarget(scope, id);
  await replaceNotificationMutes(id, scope.schoolId, input.mutedCategories, ctx);
  return getSchoolAdmin(scope, id);
}

/** Admin utama memasang peran akses (berbasis admin sekolah) ke admin tambahan sekolahnya (RBAC, 2026-10-07). */
export async function assignSchoolAdminAccessRole(scope: SchoolScope, id: string, accessRoleId: string | null, ctx: ActionContext) {
  await manageableTarget(scope, id);
  return assignAccessRole({ userId: id, schoolId: scope.schoolId }, accessRoleId, ctx);
}
