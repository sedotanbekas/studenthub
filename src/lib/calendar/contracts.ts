import { z } from "zod";
import { deletedSchema, idParams, schoolIdQuery } from "@/lib/academics/schema-common";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import {
  createHolidayBody,
  holidaySchema,
  nationalHolidaysQuery,
  schoolHolidaysQuery,
  studentCalendarQuery,
  studentCalendarSchema,
  updateHolidayBody,
} from "./schemas";

/** Kontrak route domain calendar: libur sekolah, libur nasional, kalender bulanan siswa. */
const TAG = "Kalender";
const SCOPE_NOTE = "Admin sekolah: sekolahnya sendiri. Super admin: wajib ?schoolId=.";
const SCHOOL_RULES =
  "Body tanpa schoolId (sekolah selalu dari cakupan). Nama 3-150 karakter, rentang inklusif maks. 60 hari. " +
  "Admin sekolah hanya boleh membuat/mengubah/menghapus libur yang dimulai >= hari ini lokal - 7 hari; super admin tanpa batas.";
const HOLIDAY_ERRORS = ["INVALID_DATE_RANGE", "HOLIDAY_TOO_LONG", "HOLIDAY_BACKDATE_LIMIT", "HOLIDAY_DUPLICATE"];

export const listSchoolHolidaysContract = defineContract({
  id: "listSchoolHolidays",
  method: "GET",
  path: "/api/v1/school/holidays",
  tag: TAG,
  summary: "Daftar libur sekolah + libur nasional",
  description: `Libur yang beririsan dengan tahun (default tahun berjalan) atau bulan yang diminta. ${SCOPE_NOTE}`,
  action: "calendar.read",
  query: schoolHolidaysQuery,
  response: z.array(holidaySchema),
});

export const createSchoolHolidayContract = defineContract({
  id: "createSchoolHoliday",
  method: "POST",
  path: "/api/v1/school/holidays",
  tag: TAG,
  summary: "Tambah libur sekolah",
  description: `${SCHOOL_RULES} ${SCOPE_NOTE}`,
  action: "calendar.manage",
  query: schoolIdQuery,
  body: createHolidayBody,
  response: holidaySchema,
  successStatus: 201,
  errors: HOLIDAY_ERRORS,
});

export const updateSchoolHolidayContract = defineContract({
  id: "updateSchoolHoliday",
  method: "PATCH",
  path: "/api/v1/school/holidays/{id}",
  tag: TAG,
  summary: "Ubah libur sekolah",
  description: `${SCHOOL_RULES} Libur nasional tidak dapat diubah di sini (404). ${SCOPE_NOTE}`,
  action: "calendar.manage",
  params: idParams,
  query: schoolIdQuery,
  body: updateHolidayBody,
  response: holidaySchema,
  errors: HOLIDAY_ERRORS,
});

export const deleteSchoolHolidayContract = defineContract({
  id: "deleteSchoolHoliday",
  method: "DELETE",
  path: "/api/v1/school/holidays/{id}",
  tag: TAG,
  summary: "Hapus libur sekolah",
  description: `Admin sekolah dibatasi backdate 7 hari. ${SCOPE_NOTE}`,
  action: "calendar.manage",
  params: idParams,
  query: schoolIdQuery,
  response: deletedSchema,
  errors: ["HOLIDAY_BACKDATE_LIMIT"],
});

export const listNationalHolidaysContract = defineContract({
  id: "listNationalHolidays",
  method: "GET",
  path: "/api/v1/platform/holidays",
  tag: TAG,
  summary: "Daftar libur nasional & cuti bersama (super admin)",
  description: "Libur yang beririsan dengan tahun (default tahun berjalan WIB) atau bulan yang diminta.",
  action: "calendar.national.read",
  query: nationalHolidaysQuery,
  response: z.array(holidaySchema),
});

export const createNationalHolidayContract = defineContract({
  id: "createNationalHoliday",
  method: "POST",
  path: "/api/v1/platform/holidays",
  tag: TAG,
  summary: "Tambah libur nasional (berlaku semua sekolah)",
  description: "Nama 3-150 karakter, rentang inklusif maks. 60 hari.",
  action: "calendar.national.manage",
  body: createHolidayBody,
  response: holidaySchema,
  successStatus: 201,
  errors: ["INVALID_DATE_RANGE", "HOLIDAY_TOO_LONG", "HOLIDAY_DUPLICATE"],
});

export const updateNationalHolidayContract = defineContract({
  id: "updateNationalHoliday",
  method: "PATCH",
  path: "/api/v1/platform/holidays/{id}",
  tag: TAG,
  summary: "Ubah libur nasional",
  action: "calendar.national.manage",
  params: idParams,
  body: updateHolidayBody,
  response: holidaySchema,
  errors: ["INVALID_DATE_RANGE", "HOLIDAY_TOO_LONG", "HOLIDAY_DUPLICATE"],
});

export const deleteNationalHolidayContract = defineContract({
  id: "deleteNationalHoliday",
  method: "DELETE",
  path: "/api/v1/platform/holidays/{id}",
  tag: TAG,
  summary: "Hapus libur nasional",
  action: "calendar.national.manage",
  params: idParams,
  response: deletedSchema,
});

export const getStudentCalendarContract = defineContract({
  id: "getStudentCalendar",
  method: "GET",
  path: "/api/v1/student/calendar",
  tag: TAG,
  summary: "Kalender bulanan siswa (hari sekolah, libur, di luar semester)",
  description: "Hari sekolah = hari masuk menurut School.schoolDaysMask, tidak libur, dan berada dalam semester. Siswa AKTIF & LULUS.",
  action: "calendar.student.read",
  query: studentCalendarQuery,
  response: studentCalendarSchema,
});

export const calendarContracts: readonly AnyContract[] = [
  listSchoolHolidaysContract,
  createSchoolHolidayContract,
  updateSchoolHolidayContract,
  deleteSchoolHolidayContract,
  listNationalHolidaysContract,
  createNationalHolidayContract,
  updateNationalHolidayContract,
  deleteNationalHolidayContract,
  getStudentCalendarContract,
];
