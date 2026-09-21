import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { auditLogSchema, platformAuditQuery, schoolAuditQuery } from "./audit-schemas";
import {
  activateUserResult,
  createUserBody,
  createUserResult,
  deactivateUserBody,
  deactivateUserResult,
  listUsersQuery,
  platformUserDetailSchema,
  platformUserSchema,
  resetPasswordBody,
  resetPasswordResult,
  revokeSessionsResult,
  updateUserBody,
  userIdParams,
} from "./schemas";

/** Kontrak route pengelolaan akun (/platform/users*) dan log audit (/platform|school/audit-logs). */
const USERS_TAG = "Super Admin - Pengguna";
const AUDIT_TAG = "Log Audit";

export const listPlatformUsersContract = defineContract({
  id: "listPlatformUsers",
  method: "GET",
  path: "/api/v1/platform/users",
  tag: USERS_TAG,
  summary: "Cari semua akun (nama/email, peran, sekolah, sponsor, status aktif)",
  action: "users.manage",
  query: listUsersQuery,
  response: z.array(platformUserSchema),
  pagination: "page",
});

export const createPlatformUserContract = defineContract({
  id: "createPlatformUser",
  method: "POST",
  path: "/api/v1/platform/users",
  tag: USERS_TAG,
  summary: "Buat akun admin sekolah atau super admin",
  description: [
    "SPONSOR dan STUDENT -> 400 `USE_DEDICATED_ENDPOINT` (pakai endpoint sponsor/siswa). SCHOOL_ADMIN wajib `schoolId` sekolah aktif.",
    "Email unik tanpa peka huruf (409 `EMAIL_TAKEN`). `initialPassword` opsional dicek kebijakan (422 `PASSWORD_POLICY`);",
    "bila kosong sistem membuat kata sandi sementara (berlaku 14 hari) yang dikembalikan SEKALI sebagai `temporaryPassword`.",
    "Akun baru wajib ganti kata sandi saat login pertama.",
  ].join(" "),
  action: "users.manage",
  body: createUserBody,
  response: createUserResult,
  successStatus: 201,
  errors: ["USE_DEDICATED_ENDPOINT", "SCHOOL_ID_REQUIRED", "SCHOOL_ID_NOT_ALLOWED", "SCHOOL_INACTIVE", "EMAIL_TAKEN", "PASSWORD_POLICY"],
});

export const getPlatformUserContract = defineContract({
  id: "getPlatformUser",
  method: "GET",
  path: "/api/v1/platform/users/{id}",
  tag: USERS_TAG,
  summary: "Detail akun + jumlah sesi aktif",
  action: "users.manage",
  params: userIdParams,
  response: platformUserDetailSchema,
});

export const updatePlatformUserContract = defineContract({
  id: "updatePlatformUser",
  method: "PATCH",
  path: "/api/v1/platform/users/{id}",
  tag: USERS_TAG,
  summary: "Ubah nama atau email akun",
  description: "Peran, sekolah, dan sponsor tidak dapat diubah. Akun siswa diubah lewat endpoint siswa (400 `USE_STUDENT_ENDPOINT`).",
  action: "users.manage",
  params: userIdParams,
  body: updateUserBody,
  response: platformUserSchema,
  errors: ["USE_STUDENT_ENDPOINT", "EMAIL_TAKEN"],
});

export const deactivatePlatformUserContract = defineContract({
  id: "deactivatePlatformUser",
  method: "POST",
  path: "/api/v1/platform/users/{id}/deactivate",
  tag: USERS_TAG,
  summary: "Nonaktifkan akun non-siswa (semua sesi dicabut)",
  description: [
    "Siswa -> 400 `USE_STUDENT_STATUS`; diri sendiri -> 400 `CANNOT_TARGET_SELF`; super admin aktif terakhir -> 409 `LAST_SUPER_ADMIN`.",
    "Berlaku pada request berikutnya pengguna tersebut (401).",
  ].join(" "),
  action: "users.manage",
  params: userIdParams,
  body: deactivateUserBody,
  response: deactivateUserResult,
  errors: ["USE_STUDENT_STATUS", "CANNOT_TARGET_SELF", "LAST_SUPER_ADMIN", "USER_ALREADY_INACTIVE"],
});

export const activatePlatformUserContract = defineContract({
  id: "activatePlatformUser",
  method: "POST",
  path: "/api/v1/platform/users/{id}/activate",
  tag: USERS_TAG,
  summary: "Aktifkan kembali akun non-siswa",
  action: "users.manage",
  params: userIdParams,
  response: activateUserResult,
  errors: ["USE_STUDENT_STATUS", "CANNOT_TARGET_SELF", "USER_ALREADY_ACTIVE"],
});

export const revokePlatformUserSessionsContract = defineContract({
  id: "revokePlatformUserSessions",
  method: "POST",
  path: "/api/v1/platform/users/{id}/revoke-sessions",
  tag: USERS_TAG,
  summary: "Paksa logout semua perangkat pengguna",
  description: "Untuk akun sendiri gunakan logout-all (400 `CANNOT_TARGET_SELF`).",
  action: "users.manage",
  params: userIdParams,
  response: revokeSessionsResult,
  errors: ["CANNOT_TARGET_SELF"],
});

export const resetPlatformUserPasswordContract = defineContract({
  id: "resetPlatformUserPassword",
  method: "POST",
  path: "/api/v1/platform/users/{id}/reset-password",
  tag: USERS_TAG,
  summary: "Reset kata sandi akun non-siswa",
  description: [
    "`newPassword` opsional (dicek kebijakan, 422 `PASSWORD_POLICY`); bila kosong sistem membuat kata sandi sementara 14 hari",
    "yang dikembalikan SEKALI. Semua sesi dicabut dan pengguna wajib ganti kata sandi. Siswa -> 400 `USE_STUDENT_ENDPOINT`;",
    "diri sendiri -> 400 `USE_CHANGE_PASSWORD`. Dibatasi 30 reset/jam per admin.",
  ].join(" "),
  action: "users.manage",
  params: userIdParams,
  body: resetPasswordBody,
  response: resetPasswordResult,
  rateLimit: { limiter: "ADMIN_RESET", key: "user" },
  errors: ["USE_STUDENT_ENDPOINT", "USE_CHANGE_PASSWORD", "PASSWORD_POLICY"],
});

export const listPlatformAuditLogsContract = defineContract({
  id: "listPlatformAuditLogs",
  method: "GET",
  path: "/api/v1/platform/audit-logs",
  tag: AUDIT_TAG,
  summary: "Log audit seluruh platform (terbaru dulu)",
  description: "Filter pelaku, sekolah, entitas, aksi, dan rentang waktu ISO 8601 (`from`/`to` inklusif). Kunci rahasia sudah diredaksi.",
  action: "audit.platform.read",
  query: platformAuditQuery,
  response: z.array(auditLogSchema),
  pagination: "page",
});

export const listSchoolAuditLogsContract = defineContract({
  id: "listSchoolAuditLogs",
  method: "GET",
  path: "/api/v1/school/audit-logs",
  tag: AUDIT_TAG,
  summary: "Log audit sekolah sendiri (terbaru dulu)",
  description: "Admin sekolah selalu dibatasi ke sekolahnya (schoolId lain -> 403 `SCOPE_MISMATCH`); SUPER_ADMIN wajib `?schoolId=`.",
  action: "audit.school.read",
  query: schoolAuditQuery,
  response: z.array(auditLogSchema),
  pagination: "page",
});

export const usersContracts: readonly AnyContract[] = [
  listPlatformUsersContract,
  createPlatformUserContract,
  getPlatformUserContract,
  updatePlatformUserContract,
  deactivatePlatformUserContract,
  activatePlatformUserContract,
  revokePlatformUserSessionsContract,
  resetPlatformUserPasswordContract,
  listPlatformAuditLogsContract,
  listSchoolAuditLogsContract,
];
