import { z } from "zod";
import { schoolIdQuery } from "@/lib/academics/schema-common";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import {
  accessRoleDetailSchema,
  accessRoleIdParams,
  accessRoleRefSchema,
  accessRoleSchema,
  assignAccessRoleBody,
  createAccessRoleBody,
  listAccessRolesQuery,
  permissionCatalogSchema,
  updateAccessRoleBody,
} from "./schemas";

/** Kontrak route peran akses RBAC (2026-10-07). */
const TAG = "Peran & Hak Akses";

const RULES = [
  "Hak efektif akun = aksi yang diizinkan POLICY untuk jenis akunnya DAN dicentang di perannya (RBAC hanya mempersempit).",
  "Hak terkunci (masuk, keamanan akun, notifikasi; peran sistem super admin juga kelola peran & pengguna) selalu tercentang.",
].join(" ");

export const listAccessRolesContract = defineContract({
  id: "listAccessRoles",
  method: "GET",
  path: "/api/v1/access-roles",
  tag: TAG,
  summary: "Daftar peran akses + jumlah akun pemakai",
  description: `${RULES} Admin sekolah hanya melihat peran berbasis SCHOOL_ADMIN dan jumlah akun sekolahnya sendiri.`,
  action: "roles.read",
  query: listAccessRolesQuery,
  response: z.array(accessRoleSchema),
});

export const getPermissionCatalogContract = defineContract({
  id: "getPermissionCatalog",
  method: "GET",
  path: "/api/v1/access-roles/catalog",
  tag: TAG,
  summary: "Katalog hak akses per kelompok (nama, penjelasan, jenis akun yang boleh)",
  action: "roles.read",
  response: permissionCatalogSchema,
});

export const getAccessRoleContract = defineContract({
  id: "getAccessRole",
  method: "GET",
  path: "/api/v1/access-roles/{id}",
  tag: TAG,
  summary: "Detail peran akses + akun pemakainya",
  action: "roles.read",
  params: accessRoleIdParams,
  response: accessRoleDetailSchema,
});

export const createAccessRoleContract = defineContract({
  id: "createAccessRole",
  method: "POST",
  path: "/api/v1/access-roles",
  tag: TAG,
  summary: "Buat peran akses baru (boleh menyalin centang peran lain)",
  description: `${RULES} Aksi bukan untuk jenis akun ini -> 422 INVALID_PERMISSION.`,
  action: "roles.manage",
  body: createAccessRoleBody,
  response: accessRoleDetailSchema,
  successStatus: 201,
  errors: ["ROLE_NAME_INVALID", "ROLE_KEY_TAKEN", "INVALID_PERMISSION", "ROLE_BASE_MISMATCH"],
});

export const updateAccessRoleContract = defineContract({
  id: "updateAccessRole",
  method: "PATCH",
  path: "/api/v1/access-roles/{id}",
  tag: TAG,
  summary: "Ubah nama, keterangan, atau centang hak peran akses",
  description: `${RULES} Mencabut hak kelola peran dari peran yang sedang Anda pakai -> 422 ROLE_SELF_LOCKOUT. Berlaku seketika.`,
  action: "roles.manage",
  params: accessRoleIdParams,
  body: updateAccessRoleBody,
  response: accessRoleDetailSchema,
  errors: ["INVALID_PERMISSION", "ROLE_SELF_LOCKOUT"],
});

export const deleteAccessRoleContract = defineContract({
  id: "deleteAccessRole",
  method: "DELETE",
  path: "/api/v1/access-roles/{id}",
  tag: TAG,
  summary: "Hapus peran buatan; akun pemakainya kembali ke peran sistem",
  description: "Peran sistem -> 409 SYSTEM_ROLE_LOCKED. Peran yang sedang Anda pakai -> 409 ROLE_IN_USE_BY_YOU.",
  action: "roles.manage",
  params: accessRoleIdParams,
  response: z.object({ id: z.string(), usersReset: z.number().int() }),
  errors: ["SYSTEM_ROLE_LOCKED", "ROLE_IN_USE_BY_YOU"],
});

const assignResult = z.object({ accessRole: accessRoleRefSchema });

export const assignPlatformUserAccessRoleContract = defineContract({
  id: "assignPlatformUserAccessRole",
  method: "PUT",
  path: "/api/v1/platform/users/{id}/access-role",
  tag: TAG,
  summary: "Pasang peran akses ke akun mana pun (null = peran sistem)",
  description: "Peran wajib berjenis akun sama dengan akun (422 ROLE_BASE_MISMATCH). Mengunci diri sendiri -> 422 ROLE_SELF_LOCKOUT.",
  action: "roles.manage",
  params: accessRoleIdParams,
  body: assignAccessRoleBody,
  response: assignResult,
  errors: ["ROLE_BASE_MISMATCH", "ROLE_SELF_LOCKOUT"],
});

export const assignSchoolAdminAccessRoleContract = defineContract({
  id: "assignSchoolAdminAccessRole",
  method: "PUT",
  path: "/api/v1/school/admins/{id}/access-role",
  tag: TAG,
  summary: "Admin utama memasang peran akses (berbasis admin sekolah) ke guru/admin tambahan",
  description: "Hanya akun admin tambahan di sekolah sendiri (admin utama dilindungi -> 403 PRIMARY_ADMIN_PROTECTED). Super admin wajib ?schoolId=.",
  action: "schoolAdmins.manage",
  params: accessRoleIdParams,
  query: schoolIdQuery,
  body: assignAccessRoleBody,
  response: assignResult,
  errors: ["ROLE_BASE_MISMATCH", "PRIMARY_ADMIN_PROTECTED"],
});

export const accessRolesContracts: readonly AnyContract[] = [
  listAccessRolesContract,
  getPermissionCatalogContract,
  getAccessRoleContract,
  createAccessRoleContract,
  updateAccessRoleContract,
  deleteAccessRoleContract,
  assignPlatformUserAccessRoleContract,
  assignSchoolAdminAccessRoleContract,
];
