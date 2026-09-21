import { z } from "zod";
import { defineContract } from "@/lib/http/contract";
import { deletedSchema, idParams, schoolIdQuery } from "./schema-common";
import {
  academicYearSchema,
  activeTermSchema,
  createAcademicYearBody,
  createTermBody,
  setActiveTermBody,
  setActiveTermResultSchema,
  termSchema,
  updateAcademicYearBody,
  updateTermBody,
} from "./schemas";

/** Kontrak tahun ajaran, semester, dan semester aktif (/school/*; SUPER_ADMIN wajib ?schoolId). */
const TAG = "Akademik";
const SCOPE_NOTE = "Admin sekolah: sekolahnya sendiri. Super admin: wajib ?schoolId=.";

export const listAcademicYearsContract = defineContract({
  id: "listAcademicYears",
  method: "GET",
  path: "/api/v1/school/academic-years",
  tag: TAG,
  summary: "Daftar tahun ajaran beserta semesternya",
  description: SCOPE_NOTE,
  action: "academics.read",
  query: schoolIdQuery,
  response: z.array(academicYearSchema),
});

export const createAcademicYearContract = defineContract({
  id: "createAcademicYear",
  method: "POST",
  path: "/api/v1/school/academic-years",
  tag: TAG,
  summary: "Buat tahun ajaran",
  description: `Nama YYYY/YYYY+1, tanggal mulai di tahun pertama, rentang maks. 400 hari, tidak beririsan dengan tahun ajaran lain. ${SCOPE_NOTE}`,
  action: "academics.manage",
  query: schoolIdQuery,
  body: createAcademicYearBody,
  response: academicYearSchema,
  successStatus: 201,
  errors: ["INVALID_DATE_RANGE", "ACADEMIC_YEAR_TOO_LONG", "ACADEMIC_YEAR_NAME_MISMATCH", "ACADEMIC_YEAR_NAME_TAKEN", "ACADEMIC_YEAR_OVERLAP"],
});

export const updateAcademicYearContract = defineContract({
  id: "updateAcademicYear",
  method: "PATCH",
  path: "/api/v1/school/academic-years/{id}",
  tag: TAG,
  summary: "Ubah tahun ajaran",
  description: `Rentang baru wajib tetap mencakup semua semesternya. ${SCOPE_NOTE}`,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  body: updateAcademicYearBody,
  response: academicYearSchema,
  errors: [
    "INVALID_DATE_RANGE", "ACADEMIC_YEAR_TOO_LONG", "ACADEMIC_YEAR_NAME_MISMATCH", "ACADEMIC_YEAR_EXCLUDES_TERMS",
    "ACADEMIC_YEAR_NAME_TAKEN", "ACADEMIC_YEAR_OVERLAP",
  ],
});

export const deleteAcademicYearContract = defineContract({
  id: "deleteAcademicYear",
  method: "DELETE",
  path: "/api/v1/school/academic-years/{id}",
  tag: TAG,
  summary: "Hapus tahun ajaran (hanya bila belum punya semester/kelas)",
  description: SCOPE_NOTE,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  response: deletedSchema,
  errors: ["ACADEMIC_YEAR_IN_USE"],
});

export const createTermContract = defineContract({
  id: "createTerm",
  method: "POST",
  path: "/api/v1/school/academic-years/{id}/terms",
  tag: TAG,
  summary: "Tambah semester ke tahun ajaran",
  description: `Satu semester per jenis (GANJIL/GENAP), di dalam tahun ajaran, maks. 200 hari; Ganjil selesai sebelum Genap dimulai. ${SCOPE_NOTE}`,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  body: createTermBody,
  response: termSchema,
  successStatus: 201,
  errors: ["INVALID_DATE_RANGE", "TERM_TOO_LONG", "TERM_OUTSIDE_YEAR", "TERM_ORDER_INVALID", "TERM_SEMESTER_TAKEN"],
});

export const updateTermContract = defineContract({
  id: "updateTerm",
  method: "PATCH",
  path: "/api/v1/school/terms/{id}",
  tag: TAG,
  summary: "Ubah tanggal semester",
  description: `Menyempitkan semester ditolak bila sudah ada absensi pada tanggal yang dilepas. ${SCOPE_NOTE}`,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  body: updateTermBody,
  response: termSchema,
  errors: ["INVALID_DATE_RANGE", "TERM_TOO_LONG", "TERM_OUTSIDE_YEAR", "TERM_ORDER_INVALID", "TERM_HAS_ATTENDANCE"],
});

export const deleteTermContract = defineContract({
  id: "deleteTerm",
  method: "DELETE",
  path: "/api/v1/school/terms/{id}",
  tag: TAG,
  summary: "Hapus semester (bukan semester aktif, tanpa rapor & absensi)",
  description: SCOPE_NOTE,
  action: "academics.manage",
  params: idParams,
  query: schoolIdQuery,
  response: deletedSchema,
  errors: ["TERM_ACTIVE", "TERM_IN_USE", "TERM_HAS_ATTENDANCE"],
});

export const getActiveTermContract = defineContract({
  id: "getActiveTerm",
  method: "GET",
  path: "/api/v1/school/active-term",
  tag: TAG,
  summary: "Semester aktif sekolah",
  description: `term & academicYear bernilai null bila belum ditetapkan. ${SCOPE_NOTE}`,
  action: "academics.read",
  query: schoolIdQuery,
  response: activeTermSchema,
});

export const setActiveTermContract = defineContract({
  id: "setActiveTerm",
  method: "PUT",
  path: "/api/v1/school/active-term",
  tag: TAG,
  summary: "Tetapkan semester aktif",
  description: `Hanya mengubah School.activeTermId (diaudit). activeStudentsOutsideYear = peringatan jumlah siswa aktif yang kelasnya bukan di tahun ajaran semester ini. ${SCOPE_NOTE}`,
  action: "academics.manage",
  query: schoolIdQuery,
  body: setActiveTermBody,
  response: setActiveTermResultSchema,
});

export const academicYearContracts = [
  listAcademicYearsContract,
  createAcademicYearContract,
  updateAcademicYearContract,
  deleteAcademicYearContract,
  createTermContract,
  updateTermContract,
  deleteTermContract,
  getActiveTermContract,
  setActiveTermContract,
] as const;
