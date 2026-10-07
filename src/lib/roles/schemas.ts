import { z } from "zod";
import { USER_ROLES } from "@/lib/users/schemas";
import { PERMISSION_GROUPS } from "./catalog";

/** Skema zod peran akses RBAC (/api/v1/access-roles*, 2026-10-07). */
const idString = z.string().trim().min(1).max(64);
const userRole = z.enum(USER_ROLES);
const permissionList = z
  .array(z.string().trim().min(1).max(64))
  .max(200)
  .meta({ description: "Aksi POLICY yang dicentang. Aksi terkunci (masuk, keamanan akun, notifikasi) selalu ikut tercentang." });

export const accessRoleIdParams = z.object({ id: idString.meta({ description: "ID peran akses." }) });

export const listAccessRolesQuery = z.object({
  baseRole: userRole.optional().meta({ description: "Saring per jenis akun. Admin sekolah selalu hanya melihat peran SCHOOL_ADMIN." }),
});
export type ListAccessRolesQuery = z.output<typeof listAccessRolesQuery>;

export const createAccessRoleBody = z.strictObject({
  name: z.string().trim().min(3).max(100),
  description: z.string().trim().max(500).optional(),
  baseRole: userRole.meta({ description: "Jenis akun yang bisa memakai peran ini; tidak bisa diubah setelah dibuat." }),
  permissions: permissionList.optional().meta({ description: "Kosong + copyFromId = salin centang peran sumber; kosong tanpa sumber = hanya hak terkunci." }),
  copyFromId: idString.optional().meta({ description: "Salin centang dari peran lain berjenis akun sama." }),
});
export type CreateAccessRoleInput = z.output<typeof createAccessRoleBody>;

export const updateAccessRoleBody = z
  .strictObject({
    name: z.string().trim().min(3).max(100).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    permissions: permissionList.optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined || v.permissions !== undefined, { message: "Minimal satu kolom harus diubah." });
export type UpdateAccessRoleInput = z.output<typeof updateAccessRoleBody>;

export const assignAccessRoleBody = z.strictObject({
  accessRoleId: idString.nullable().meta({ description: "Peran berjenis akun sama dengan akun; null = kembali ke peran sistem." }),
});

// ----------------------------------------------------------------------------- respons

export const accessRoleSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    baseRole: userRole,
    isSystem: z.boolean(),
    permissions: z.array(z.string()).meta({ description: "Hak EFEKTIF (sudah termasuk aksi terkunci & aksi baru untuk peran sistem)." }),
    lockedPermissions: z.array(z.string()).meta({ description: "Tidak bisa dicabut dari peran ini." }),
    availablePermissions: z.array(z.string()).meta({ description: "Semua aksi yang mungkin untuk jenis akun ini." }),
    userCount: z.number().int(),
    updatedAt: z.iso.datetime(),
  })
  .meta({ id: "AccessRole" });
export type AccessRoleDto = z.output<typeof accessRoleSchema>;

export const accessRoleMemberSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  schoolName: z.string().nullable(),
  isActive: z.boolean(),
});

export const accessRoleDetailSchema = accessRoleSchema
  .extend({ members: z.array(accessRoleMemberSchema).meta({ description: "Maks. 200 akun pemakai (terbaru dulu)." }) })
  .meta({ id: "AccessRoleDetail" });
export type AccessRoleDetailDto = z.output<typeof accessRoleDetailSchema>;

export const permissionCatalogSchema = z
  .array(
    z.object({
      group: z.enum(PERMISSION_GROUPS),
      items: z.array(
        z.object({
          action: z.string(),
          label: z.string(),
          hint: z.string(),
          baseRoles: z.array(userRole).meta({ description: "Jenis akun yang boleh diberi hak ini." }),
        }),
      ),
    }),
  )
  .meta({ id: "PermissionCatalog" });
export type PermissionCatalogDto = z.output<typeof permissionCatalogSchema>;

/** Ringkas peran untuk DTO akun (pengguna platform & admin sekolah). */
export const accessRoleRefSchema = z.object({ id: z.string(), name: z.string(), isSystem: z.boolean() }).nullable();
