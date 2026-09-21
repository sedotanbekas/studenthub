import { defineContract, type AnyContract } from "@/lib/http/contract";
import {
  authTokensSchema,
  changePasswordBodySchema,
  changePasswordResultSchema,
  loginBodySchema,
  logoutAllResultSchema,
  logoutResultSchema,
  meSchema,
  pushTokenBodySchema,
  pushTokenRegisteredSchema,
  pushTokenRemovedSchema,
  refreshBodySchema,
  sessionIdParams,
  sessionListSchema,
} from "./auth-schemas";

/** Kontrak route domain auth: /api/v1/auth/* dan /api/v1/me/* (sesi & token push milik sendiri). */
const TAG = "Auth";

export const loginContract = defineContract({
  id: "authLogin",
  method: "POST",
  path: "/api/v1/auth/login",
  tag: TAG,
  summary: "Login dengan NISN (siswa) atau email (admin/sponsor/super admin)",
  description: [
    "Identifier tepat 10 digit = NISN (hanya akun siswa), selain itu email (hanya non-siswa).",
    "Gagal login selalu 401 `INVALID_CREDENTIALS` dengan pesan seragam. Limiter hanya-kegagalan: pasangan IP+identifier (8/10 menit),",
    "identifier (10/15 menit), dan IP (200/10 menit) -> 429 `RATE_LIMITED` + header `Retry-After`.",
    "Siswa di ANDROID/IOS wajib `deviceId`; login mobile siswa mencabut sesi mobile lamanya (satu HP aktif).",
  ].join(" "),
  action: "public",
  body: loginBodySchema,
  response: authTokensSchema,
  errors: ["INVALID_CREDENTIALS", "ACCOUNT_INACTIVE", "TEMP_PASSWORD_EXPIRED", "DEVICE_ID_REQUIRED", "PUSH_TOKEN_WEB_SESSION", "RATE_LIMITED"],
});

export const refreshContract = defineContract({
  id: "authRefresh",
  method: "POST",
  path: "/api/v1/auth/refresh",
  tag: TAG,
  summary: "Tukar refresh token dengan pasangan token baru (rotasi)",
  description: [
    "Refresh token dirotasi setiap dipakai. Token lama dipakai lagi <= 30 detik setelah rotasi -> 409 `REFRESH_RACE`",
    "(baca ulang token tersimpan lalu ulangi); > 30 detik -> seluruh sesi dicabut dan 401 `SESSION_INVALID`.",
    "Jangan kirim header Authorization ke endpoint ini.",
  ].join(" "),
  action: "public",
  body: refreshBodySchema,
  response: authTokensSchema,
  rateLimit: { limiter: "REFRESH_IP", key: "ip" },
  errors: ["SESSION_INVALID", "REFRESH_RACE", "ACCOUNT_INACTIVE"],
});

export const logoutContract = defineContract({
  id: "authLogout",
  method: "POST",
  path: "/api/v1/auth/logout",
  tag: TAG,
  summary: "Logout sesi saat ini (token push sesi ikut dihapus)",
  action: "auth.self",
  response: logoutResultSchema,
});

export const logoutAllContract = defineContract({
  id: "authLogoutAll",
  method: "POST",
  path: "/api/v1/auth/logout-all",
  tag: TAG,
  summary: "Logout dari semua perangkat (termasuk sesi saat ini)",
  action: "auth.self",
  response: logoutAllResultSchema,
});

export const meContract = defineContract({
  id: "authMe",
  method: "GET",
  path: "/api/v1/auth/me",
  tag: TAG,
  summary: "Identitas, cakupan, dan izin pemanggil",
  description: "Tetap dapat diakses saat wajib ganti kata sandi (`mustChangePassword`).",
  action: "auth.self",
  response: meSchema,
});

export const changePasswordContract = defineContract({
  id: "authChangePassword",
  method: "POST",
  path: "/api/v1/auth/change-password",
  tag: TAG,
  summary: "Ganti kata sandi (sukarela atau wajib saat login pertama)",
  description: [
    "Kebijakan: minimal 8 karakter, maks 72 byte, huruf + angka, tidak memuat NISN/NIS/email/tanggal lahir, bukan kata sandi umum.",
    "Sesi saat ini tetap berlaku; semua sesi lain dicabut. 5 kali kata sandi lama salah -> 429 `RATE_LIMITED`.",
  ].join(" "),
  action: "auth.self",
  body: changePasswordBodySchema,
  response: changePasswordResultSchema,
  errors: ["CURRENT_PASSWORD_INVALID", "PASSWORD_POLICY", "PASSWORD_REUSED", "RATE_LIMITED"],
});

export const listMySessionsContract = defineContract({
  id: "listMySessions",
  method: "GET",
  path: "/api/v1/me/sessions",
  tag: TAG,
  summary: "Daftar sesi (perangkat) yang masih aktif milik sendiri",
  action: "auth.self",
  response: sessionListSchema,
});

export const revokeMySessionContract = defineContract({
  id: "revokeMySession",
  method: "DELETE",
  path: "/api/v1/me/sessions/{id}",
  tag: TAG,
  summary: "Cabut salah satu sesi milik sendiri",
  description: "Sesi milik pengguna lain -> 404.",
  action: "auth.self",
  params: sessionIdParams,
  response: logoutResultSchema,
});

export const registerPushTokenContract = defineContract({
  id: "registerMyPushToken",
  method: "PUT",
  path: "/api/v1/me/push-token",
  tag: TAG,
  summary: "Pasang token push Expo pada sesi mobile saat ini",
  description: "Token dipindahkan dari sesi lain yang memegangnya (satu HP hanya menerima push satu akun).",
  action: "auth.self",
  body: pushTokenBodySchema,
  response: pushTokenRegisteredSchema,
  errors: ["PUSH_TOKEN_INVALID", "PUSH_TOKEN_WEB_SESSION"],
});

export const removePushTokenContract = defineContract({
  id: "removeMyPushToken",
  method: "DELETE",
  path: "/api/v1/me/push-token",
  tag: TAG,
  summary: "Hapus token push Expo dari sesi mobile saat ini",
  action: "auth.self",
  response: pushTokenRemovedSchema,
  errors: ["PUSH_TOKEN_WEB_SESSION"],
});

export const authContracts: readonly AnyContract[] = [
  loginContract,
  refreshContract,
  logoutContract,
  logoutAllContract,
  meContract,
  changePasswordContract,
  listMySessionsContract,
  revokeMySessionContract,
  registerPushTokenContract,
  removePushTokenContract,
];
