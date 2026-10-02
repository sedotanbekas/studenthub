import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { activateUserResult, deactivateUserResult, resetPasswordResult, revokeSessionsResult } from "@/lib/users/schemas";
import {
  createSchoolAdminBody,
  createSchoolAdminResult,
  deactivateSchoolAdminBody,
  listSchoolAdminsQuery,
  resetSchoolAdminPasswordBody,
  schoolAdminIdParams,
  schoolAdminSchema,
  schoolIdQuery,
  updateSchoolAdminBody,
} from "./schemas";

/**
 * Kontrak /school/admins* — akun admin tambahan sekolah (guru/wali kelas). Semua admin sekolah boleh melihat;
 * hanya ADMIN UTAMA (dan super admin dengan ?schoolId=) yang mengelola (403 PRIMARY_ADMIN_ONLY).
 */
const TAG = "Admin Sekolah - Akun admin & guru";
const MANAGE_NOTE = "Hanya admin utama sekolah (403 `PRIMARY_ADMIN_ONLY`) atau super admin dengan `?schoolId=`.";
const TARGET_NOTE = "Akun di luar sekolah / bukan admin sekolah -> 404; admin utama -> 403 `PRIMARY_ADMIN_PROTECTED` (diubah super admin).";
const SCOPE_ERRORS = ["SCHOOL_ID_REQUIRED", "SCOPE_MISMATCH", "PRIMARY_ADMIN_ONLY"];
const TARGET_ERRORS = [...SCOPE_ERRORS, "PRIMARY_ADMIN_PROTECTED"];

export const listSchoolAdminsContract = defineContract({
  id: "listSchoolAdmins",
  method: "GET",
  path: "/api/v1/school/admins",
  tag: TAG,
  summary: "Daftar akun admin sekolah (admin utama dulu)",
  action: "schoolAdmins.read",
  query: listSchoolAdminsQuery,
  response: z.array(schoolAdminSchema),
  pagination: "page",
});

export const createSchoolAdminContract = defineContract({
  id: "createSchoolAdmin",
  method: "POST",
  path: "/api/v1/school/admins",
  tag: TAG,
  summary: "Buat akun admin tambahan untuk guru/wali kelas",
  description: [
    MANAGE_NOTE,
    "Masuk dengan email (unik, 409 `EMAIL_TAKEN`). `initialPassword` opsional (422 `PASSWORD_POLICY`); bila kosong sistem",
    "membuat kata sandi sementara 14 hari yang dikembalikan SEKALI. Akun baru wajib ganti kata sandi saat login pertama.",
    "Maksimal 100 akun admin per sekolah (409 `SCHOOL_ADMIN_LIMIT`). Sekolah tanpa admin utama -> 409 `PRIMARY_ADMIN_MISSING`",
    "(admin utama dibuat super admin lewat /platform/users).",
  ].join(" "),
  action: "schoolAdmins.manage",
  query: schoolIdQuery,
  body: createSchoolAdminBody,
  response: createSchoolAdminResult,
  successStatus: 201,
  errors: [...SCOPE_ERRORS, "SCHOOL_INACTIVE", "EMAIL_TAKEN", "PASSWORD_POLICY", "SCHOOL_ADMIN_LIMIT", "PRIMARY_ADMIN_MISSING"],
});

export const getSchoolAdminContract = defineContract({
  id: "getSchoolAdmin",
  method: "GET",
  path: "/api/v1/school/admins/{id}",
  tag: TAG,
  summary: "Detail akun admin sekolah",
  action: "schoolAdmins.read",
  params: schoolAdminIdParams,
  query: schoolIdQuery,
  response: schoolAdminSchema,
});

export const updateSchoolAdminContract = defineContract({
  id: "updateSchoolAdmin",
  method: "PATCH",
  path: "/api/v1/school/admins/{id}",
  tag: TAG,
  summary: "Ubah nama atau email akun admin tambahan",
  description: `${MANAGE_NOTE} ${TARGET_NOTE}`,
  action: "schoolAdmins.manage",
  params: schoolAdminIdParams,
  query: schoolIdQuery,
  body: updateSchoolAdminBody,
  response: schoolAdminSchema,
  errors: [...TARGET_ERRORS, "EMAIL_TAKEN"],
});

export const deactivateSchoolAdminContract = defineContract({
  id: "deactivateSchoolAdmin",
  method: "POST",
  path: "/api/v1/school/admins/{id}/deactivate",
  tag: TAG,
  summary: "Nonaktifkan akun admin tambahan (semua sesinya dicabut)",
  description: `${MANAGE_NOTE} ${TARGET_NOTE}`,
  action: "schoolAdmins.manage",
  params: schoolAdminIdParams,
  query: schoolIdQuery,
  body: deactivateSchoolAdminBody,
  response: deactivateUserResult,
  errors: [...TARGET_ERRORS, "CANNOT_TARGET_SELF", "USER_ALREADY_INACTIVE"],
});

export const activateSchoolAdminContract = defineContract({
  id: "activateSchoolAdmin",
  method: "POST",
  path: "/api/v1/school/admins/{id}/activate",
  tag: TAG,
  summary: "Aktifkan kembali akun admin tambahan",
  description: `${MANAGE_NOTE} ${TARGET_NOTE}`,
  action: "schoolAdmins.manage",
  params: schoolAdminIdParams,
  query: schoolIdQuery,
  response: activateUserResult,
  errors: [...TARGET_ERRORS, "CANNOT_TARGET_SELF", "USER_ALREADY_ACTIVE"],
});

export const resetSchoolAdminPasswordContract = defineContract({
  id: "resetSchoolAdminPassword",
  method: "POST",
  path: "/api/v1/school/admins/{id}/reset-password",
  tag: TAG,
  summary: "Reset kata sandi akun admin tambahan",
  description: `${MANAGE_NOTE} ${TARGET_NOTE} Kata sandi sementara (14 hari) dikembalikan SEKALI bila \`newPassword\` kosong; semua sesi dicabut.`,
  action: "schoolAdmins.manage",
  params: schoolAdminIdParams,
  query: schoolIdQuery,
  body: resetSchoolAdminPasswordBody,
  response: resetPasswordResult,
  rateLimit: { limiter: "ADMIN_RESET", key: "user" },
  errors: [...TARGET_ERRORS, "USE_CHANGE_PASSWORD", "PASSWORD_POLICY"],
});

export const revokeSchoolAdminSessionsContract = defineContract({
  id: "revokeSchoolAdminSessions",
  method: "POST",
  path: "/api/v1/school/admins/{id}/revoke-sessions",
  tag: TAG,
  summary: "Paksa keluar semua perangkat akun admin tambahan",
  description: `${MANAGE_NOTE} ${TARGET_NOTE}`,
  action: "schoolAdmins.manage",
  params: schoolAdminIdParams,
  query: schoolIdQuery,
  response: revokeSessionsResult,
  errors: [...TARGET_ERRORS, "CANNOT_TARGET_SELF"],
});

export const schoolAdminsContracts: readonly AnyContract[] = [
  listSchoolAdminsContract,
  createSchoolAdminContract,
  getSchoolAdminContract,
  updateSchoolAdminContract,
  deactivateSchoolAdminContract,
  activateSchoolAdminContract,
  resetSchoolAdminPasswordContract,
  revokeSchoolAdminSessionsContract,
];
