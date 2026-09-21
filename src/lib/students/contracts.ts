import { z } from "zod";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { IMPORT_MAX_BODY_BYTES } from "./import/constants";
import { importStudentsBody, importStudentsResponse } from "./import/schemas";
import {
  activateStudentBody,
  changeStatusBody,
  createStudentBody,
  createStudentResponse,
  deleteStudentResponse,
  listStudentsQuery,
  resetPasswordResponse,
  schoolScopeQuery,
  statusChangeResponse,
  studentDetailSchema,
  studentIdParams,
  studentListItemSchema,
  studentProfileSchema,
  updateStudentBody,
} from "./schemas";

/** Kontrak route domain siswa: /school/students* (admin) & /student/profile (siswa). */
const TAG = "Siswa";
const SCOPE_NOTE = "SUPER_ADMIN wajib mengirim ?schoolId=. Id siswa/kelas milik sekolah lain -> 404.";
const RELEASE_NOTE =
  "NISN yang masih dipegang siswa LULUS di sekolah lain hanya dilepas bila confirmReleaseGraduatedNisn=true (409 NISN_HELD_BY_GRADUATE bila tidak); admin sekolah maks 20 pelepasan per hari lokal (429 NISN_RELEASE_LIMIT, super admin dikecualikan); setiap pelepasan diaudit di kedua sekolah dan dilaporkan ke super admin.";
/** Kode pelepasan NISN siswa LULUS lintas sekolah (lihat RELEASE_NOTE). */
const RELEASE_ERRORS = ["NISN_HELD_BY_GRADUATE", "NISN_RELEASE_LIMIT"] as const;

export const listStudentsContract = defineContract({
  id: "listSchoolStudents",
  method: "GET",
  path: "/api/v1/school/students",
  tag: TAG,
  summary: "Daftar & cari siswa sekolah",
  description: `q semua digit = awalan NIS / awalan NISN / nama memuat; selain itu nama memuat / awalan NIS. ${SCOPE_NOTE}`,
  action: "students.read",
  query: listStudentsQuery,
  response: z.array(studentListItemSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const createStudentContract = defineContract({
  id: "createSchoolStudent",
  method: "POST",
  path: "/api/v1/school/students",
  tag: TAG,
  summary: "Buat siswa (default langsung aktif)",
  description: `activate=true: data wajib lengkap (422 ACTIVATION_INCOMPLETE tanpa menulis apa pun) & NISN diklaim. activate=false: DRAFT. Kata sandi sementara selalu di-generate dan hanya ditampilkan sekali. ${RELEASE_NOTE} ${SCOPE_NOTE}`,
  action: "students.manage",
  query: schoolScopeQuery,
  body: createStudentBody,
  response: createStudentResponse,
  successStatus: 201,
  errors: ["ACTIVATION_INCOMPLETE", "NISN_ALREADY_IN_SCHOOL", "NIS_ALREADY_IN_SCHOOL", "NISN_ACTIVE_ELSEWHERE", ...RELEASE_ERRORS, "CLASS_NOT_FOUND", "CLASS_INACTIVE", "SCHOOL_NOT_FOUND"],
});

export const getStudentContract = defineContract({
  id: "getSchoolStudent",
  method: "GET",
  path: "/api/v1/school/students/{id}",
  tag: TAG,
  summary: "Detail siswa + kekurangan data aktivasi",
  description: SCOPE_NOTE,
  action: "students.read",
  params: studentIdParams,
  query: schoolScopeQuery,
  response: studentDetailSchema,
});

export const updateStudentContract = defineContract({
  id: "updateSchoolStudent",
  method: "PATCH",
  path: "/api/v1/school/students/{id}",
  tag: TAG,
  summary: "Ubah biodata / kelas / SPP siswa",
  description: `NISN hanya dapat diubah admin sekolah saat DRAFT (409 NISN_LOCKED); super admin kapan saja (klaim ulang + cabut sesi). Siswa AKTIF tidak boleh kehilangan data wajib (422). ${SCOPE_NOTE}`,
  action: "students.manage",
  params: studentIdParams,
  query: schoolScopeQuery,
  body: updateStudentBody,
  response: studentDetailSchema,
  errors: ["NISN_LOCKED", "ACTIVATION_INCOMPLETE", "NISN_ALREADY_IN_SCHOOL", "NIS_ALREADY_IN_SCHOOL", "NISN_ACTIVE_ELSEWHERE", "CLASS_NOT_FOUND", "CLASS_INACTIVE", "STUDENT_STATE_CHANGED"],
});

export const deleteStudentContract = defineContract({
  id: "deleteSchoolStudent",
  method: "DELETE",
  path: "/api/v1/school/students/{id}",
  tag: TAG,
  summary: "Hapus siswa DRAFT (beserta akunnya)",
  description: SCOPE_NOTE,
  action: "students.manage",
  params: studentIdParams,
  query: schoolScopeQuery,
  response: deleteStudentResponse,
  errors: ["STUDENT_NOT_DRAFT", "STUDENT_IN_USE"],
});

export const activateStudentContract = defineContract({
  id: "activateSchoolStudent",
  method: "POST",
  path: "/api/v1/school/students/{id}/activate",
  tag: TAG,
  summary: "Aktivasi siswa (cek data wajib + klaim NISN)",
  description: `Body JSON boleh {} (Content-Type application/json wajib). Kelas nonaktif muncul sebagai kekurangan CLASS_INACTIVE (422 ACTIVATION_INCOMPLETE). ${RELEASE_NOTE} ${SCOPE_NOTE}`,
  action: "students.manage",
  params: studentIdParams,
  query: schoolScopeQuery,
  body: activateStudentBody,
  response: statusChangeResponse,
  errors: ["ACTIVATION_INCOMPLETE", "NISN_ACTIVE_ELSEWHERE", ...RELEASE_ERRORS, "INVALID_STATUS_TRANSITION", "STUDENT_STATE_CHANGED"],
});

export const changeStudentStatusContract = defineContract({
  id: "changeSchoolStudentStatus",
  method: "POST",
  path: "/api/v1/school/students/{id}/status",
  tag: TAG,
  summary: "Ubah status siswa (Aktif/Nonaktif/Lulus/Pindah)",
  description: `Satu tabel transisi; alasan wajib kecuali ke ACTIVE. PINDAH melepas NISN, menonaktifkan akun, dan me-void tagihan masa depan. Ke ACTIVE: ${RELEASE_NOTE} ${SCOPE_NOTE}`,
  action: "students.manage",
  params: studentIdParams,
  query: schoolScopeQuery,
  body: changeStatusBody,
  response: statusChangeResponse,
  errors: ["INVALID_STATUS_TRANSITION", "ACTIVATION_INCOMPLETE", "NISN_ACTIVE_ELSEWHERE", ...RELEASE_ERRORS, "STUDENT_STATE_CHANGED"],
});

export const resetStudentPasswordContract = defineContract({
  id: "resetSchoolStudentPassword",
  method: "POST",
  path: "/api/v1/school/students/{id}/reset-password",
  tag: TAG,
  summary: "Reset kata sandi siswa (di-generate, tampil sekali)",
  description: `Kata sandi sementara berlaku 14 hari, wajib diganti saat login; semua sesi siswa dicabut. ${SCOPE_NOTE}`,
  action: "students.manage",
  params: studentIdParams,
  query: schoolScopeQuery,
  response: resetPasswordResponse,
  rateLimit: { limiter: "ADMIN_RESET", key: "user" },
});

export const importTemplateContract = defineContract({
  id: "downloadStudentImportTemplate",
  method: "GET",
  path: "/api/v1/school/students/import/template",
  tag: TAG,
  summary: "Unduh templat XLSX impor siswa",
  description: `Sheet "Siswa" (header) + sheet "Kelas" (kelas aktif tahun ajaran aktif). ${SCOPE_NOTE}`,
  action: "students.import",
  query: schoolScopeQuery,
  response: z.unknown(),
  binary: true,
});

export const importStudentsContract = defineContract({
  id: "importSchoolStudents",
  method: "POST",
  path: "/api/v1/school/students/import",
  tag: TAG,
  summary: "Impor siswa XLSX/CSV (dry-run lalu commit)",
  description: `dryRun=true (default) hanya melaporkan. Commit memvalidasi ulang, all-or-nothing (422 IMPORT_INVALID + laporan bila ada baris salah), dan mengembalikan kata sandi sementara SEKALI. Maks 2 MiB & 1.000 baris (XLSX: sheet pertama, maks 8 MiB setelah dekompresi). Commit mengunci & memeriksa ulang kelas tujuan (422 CLASS_INACTIVE). ${RELEASE_NOTE} ${SCOPE_NOTE}`,
  action: "students.import",
  query: schoolScopeQuery,
  body: importStudentsBody,
  bodyType: "multipart",
  maxBodyBytes: IMPORT_MAX_BODY_BYTES,
  response: importStudentsResponse,
  rateLimit: { limiter: "IMPORT", key: "user" },
  errors: [
    "PAYLOAD_TOO_LARGE",
    "IMPORT_FILE_INVALID",
    "IMPORT_EMPTY",
    "IMPORT_HEADERS_MISSING",
    "IMPORT_HEADERS_DUPLICATE",
    "IMPORT_TOO_MANY_ROWS",
    "IMPORT_INVALID",
    "IMPORT_CONFLICT",
    "CLASS_INACTIVE",
    ...RELEASE_ERRORS,
  ],
});

export const studentProfileContract = defineContract({
  id: "getOwnStudentProfile",
  method: "GET",
  path: "/api/v1/student/profile",
  tag: TAG,
  summary: "Biodata siswa sendiri (baca-saja)",
  description: "Untuk siswa berstatus Aktif atau Lulus.",
  action: "students.profile.read",
  response: studentProfileSchema,
});

export const studentsContracts: readonly AnyContract[] = [
  listStudentsContract,
  createStudentContract,
  getStudentContract,
  updateStudentContract,
  deleteStudentContract,
  activateStudentContract,
  changeStudentStatusContract,
  resetStudentPasswordContract,
  importTemplateContract,
  importStudentsContract,
  studentProfileContract,
];
