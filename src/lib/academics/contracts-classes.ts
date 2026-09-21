import { z } from "zod";
import { defineContract } from "@/lib/http/contract";
import { deletedSchema, idParams, schoolIdQuery } from "./schema-common";
import {
  classSchema,
  classSubjectsSchema,
  createClassBody,
  createSubjectBody,
  listClassesQuery,
  listSubjectsQuery,
  setClassSubjectsBody,
  setClassSubjectsResultSchema,
  subjectSchema,
  updateClassBody,
  updateSubjectBody,
} from "./schemas";

/** Kontrak kelas, pemetaan kelas-mapel, dan mapel (/school/*; SUPER_ADMIN wajib ?schoolId). */
const TAG = "Akademik";
const SCOPE_NOTE = "Admin sekolah: sekolahnya sendiri. Super admin: wajib ?schoolId=.";

export const listClassesContract = defineContract({
  id: "listSchoolClasses",
  method: "GET",
  path: "/api/v1/school/classes",
  tag: TAG,
  summary: "Daftar kelas (default: tahun ajaran semester aktif)",
  description: `Tanpa semester aktif dan tanpa academicYearId, semua kelas dikembalikan. ${SCOPE_NOTE}`,
  action: "academics.read",
  query: listClassesQuery,
  response: z.array(classSchema),
});

export const createClassContract = defineContract({
  id: "createSchoolClass",
  method: "POST",
  path: "/api/v1/school/classes",
  tag: TAG,
  summary: "Buat kelas",
  description: `Nama 1-50 karakter unik per tahun ajaran, tingkat 1-12. ${SCOPE_NOTE}`,
  action: "academics.manage",
  query: schoolIdQuery,
  body: createClassBody,
  response: classSchema,
  successStatus: 201,
  errors: ["CLASS_NAME_TAKEN"],
});

export const updateClassContract = defineContract({
  id: "updateSchoolClass",
  method: "PATCH",
  path: "/api/v1/school/classes/{id}",
  tag: TAG,
  summary: "Ubah atau nonaktifkan kelas",
  description: `Nonaktif hanya bila tidak ada siswa AKTIF di kelas. ${SCOPE_NOTE}`,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  body: updateClassBody,
  response: classSchema,
  errors: ["CLASS_NAME_TAKEN", "CLASS_HAS_STUDENTS"],
});

export const deleteClassContract = defineContract({
  id: "deleteSchoolClass",
  method: "DELETE",
  path: "/api/v1/school/classes/{id}",
  tag: TAG,
  summary: "Hapus kelas (hanya bila tidak dirujuk siswa/absensi/rapor/pengumuman)",
  description: SCOPE_NOTE,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  response: deletedSchema,
  errors: ["CLASS_IN_USE"],
});

export const getClassSubjectsContract = defineContract({
  id: "getClassSubjects",
  method: "GET",
  path: "/api/v1/school/classes/{id}/subjects",
  tag: TAG,
  summary: "Mapel yang dipetakan ke kelas",
  description: SCOPE_NOTE,
  action: "academics.read",
  params: idParams,
  query: schoolIdQuery,
  response: classSubjectsSchema,
});

export const setClassSubjectsContract = defineContract({
  id: "setClassSubjects",
  method: "PUT",
  path: "/api/v1/school/classes/{id}/subjects",
  tag: TAG,
  summary: "Ganti seluruh pemetaan mapel kelas",
  description: `Urutan subjectIds = urutan tampil. Mapel baru wajib aktif & milik sekolah yang sama. orphanGradeCount = nilai DRAFT milik mapel yang dilepas (tetap disimpan). ${SCOPE_NOTE}`,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  body: setClassSubjectsBody,
  response: setClassSubjectsResultSchema,
  errors: ["SUBJECT_INACTIVE"],
});

export const listSubjectsContract = defineContract({
  id: "listSubjects",
  method: "GET",
  path: "/api/v1/school/subjects",
  tag: TAG,
  summary: "Daftar mapel sekolah",
  description: SCOPE_NOTE,
  action: "academics.read",
  query: listSubjectsQuery,
  response: z.array(subjectSchema),
});

export const createSubjectContract = defineContract({
  id: "createSubject",
  method: "POST",
  path: "/api/v1/school/subjects",
  tag: TAG,
  summary: "Buat mapel",
  description: `Kode otomatis huruf besar, unik per sekolah; KKM 0-100; urutan 0-999. ${SCOPE_NOTE}`,
  action: "academics.manage",
  query: schoolIdQuery,
  body: createSubjectBody,
  response: subjectSchema,
  successStatus: 201,
  errors: ["SUBJECT_CODE_TAKEN"],
});

export const updateSubjectContract = defineContract({
  id: "updateSubject",
  method: "PATCH",
  path: "/api/v1/school/subjects/{id}",
  tag: TAG,
  summary: "Ubah atau nonaktifkan mapel",
  description: `Kode terkunci setelah dipakai nilai rapor; nonaktif ditolak selama terpetakan ke kelas aktif tahun ajaran berjalan. ${SCOPE_NOTE}`,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  body: updateSubjectBody,
  response: subjectSchema,
  errors: ["SUBJECT_CODE_TAKEN", "SUBJECT_CODE_LOCKED", "SUBJECT_MAPPED"],
});

export const deleteSubjectContract = defineContract({
  id: "deleteSubject",
  method: "DELETE",
  path: "/api/v1/school/subjects/{id}",
  tag: TAG,
  summary: "Hapus mapel (hanya bila belum dipetakan/dinilai)",
  description: SCOPE_NOTE,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  response: deletedSchema,
  errors: ["SUBJECT_IN_USE"],
});

export const classSubjectContracts = [
  listClassesContract,
  createClassContract,
  updateClassContract,
  deleteClassContract,
  getClassSubjectsContract,
  setClassSubjectsContract,
  listSubjectsContract,
  createSubjectContract,
  updateSubjectContract,
  deleteSubjectContract,
] as const;
