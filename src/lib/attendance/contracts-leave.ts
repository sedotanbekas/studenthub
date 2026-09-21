import { z } from "zod";
import { schoolIdQuery } from "@/lib/academics/schema-common";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { LEAVE_DAILY_SUBMISSION_LIMIT, LEAVE_MAX_BODY_BYTES } from "./leave-constants";
import {
  approveLeaveBody,
  createLeaveBody,
  createLeaveOnBehalfBody,
  leaveDecisionSchema,
  leaveIdParams,
  leaveRequestSchema,
  ownLeavesQuery,
  rejectLeaveBody,
  schoolLeaveDetailSchema,
  schoolLeaveSchema,
  schoolLeavesQuery,
} from "./leave-schemas";

/** Kontrak route izin/sakit: /student/leave-requests* (siswa) & /school/leave-requests* (admin). */
const TAG = "Absensi — Izin & Sakit";
const SCOPE_NOTE = "SUPER_ADMIN wajib mengirim ?schoolId=. Id milik sekolah lain -> 404.";
const RANGE_RULES =
  "Tanggal lokal sekolah; rentang maks 14 hari kalender, tanggal selesai paling lambat hari ini + 30, wajib memuat >= 1 hari sekolah (422 NO_SCHOOL_DAYS_IN_RANGE); tidak boleh beririsan dengan izin Menunggu/Disetujui milik siswa (409 LEAVE_OVERLAP; rentang bersebelahan boleh); SAKIT yang mencakup >= 3 hari sekolah wajib lampiran foto (422 ATTACHMENT_REQUIRED). Lampiran JPEG/PNG/WebP di-encode ulang (EXIF dibuang) dan disimpan privat.";
const MATERIALIZE_NOTE =
  "Setiap hari sekolah dalam rentang (lampau, hari ini, mendatang) menjadi baris absensi IZIN/SAKIT: tanpa baris -> dibuat; Alpha otomatis -> dikonversi; check-in, koreksi admin, dan izin lain dipertahankan (skipped + alasan).";
const RANGE_ERRORS = ["INVALID_DATE_RANGE", "LEAVE_TOO_LONG", "LEAVE_BACKDATE_LIMIT", "LEAVE_ADVANCE_LIMIT", "NO_SCHOOL_DAYS_IN_RANGE", "ATTACHMENT_REQUIRED", "LEAVE_OVERLAP"] as const;
const UPLOAD_ERRORS = [
  "LENGTH_REQUIRED", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "HEIC_NOT_SUPPORTED", "IMAGE_UNREADABLE", "IMAGE_TOO_LARGE", "SERVICE_UNAVAILABLE",
] as const;

export const listOwnLeavesContract = defineContract({
  id: "listOwnLeaveRequests",
  method: "GET",
  path: "/api/v1/student/leave-requests",
  tag: TAG,
  summary: "Daftar pengajuan izin/sakit milik siswa",
  description: "Terbaru dulu. Siswa Aktif atau Lulus.",
  action: "leave.self.read",
  query: ownLeavesQuery,
  response: z.array(leaveRequestSchema),
  pagination: "page",
});

export const createOwnLeaveContract = defineContract({
  id: "createOwnLeaveRequest",
  method: "POST",
  path: "/api/v1/student/leave-requests",
  tag: TAG,
  summary: "Ajukan izin/sakit (multipart)",
  description: `Tanggal mulai paling awal hari ini - 7. ${RANGE_RULES} Maks ${LEAVE_DAILY_SUBMISSION_LIMIT} pengajuan per siswa per hari lokal, termasuk yang dibatalkan (429 LEAVE_DAILY_LIMIT + Retry-After). Admin sekolah aktif menerima notifikasi LEAVE_SUBMITTED.`,
  action: "leave.self",
  body: createLeaveBody,
  bodyType: "multipart",
  maxBodyBytes: LEAVE_MAX_BODY_BYTES,
  response: leaveRequestSchema,
  successStatus: 201,
  rateLimit: { limiter: "UPLOAD", key: "user" },
  errors: [...RANGE_ERRORS, ...UPLOAD_ERRORS, "LEAVE_DAILY_LIMIT"],
});

export const getOwnLeaveContract = defineContract({
  id: "getOwnLeaveRequest",
  method: "GET",
  path: "/api/v1/student/leave-requests/{id}",
  tag: TAG,
  summary: "Detail pengajuan izin/sakit milik siswa",
  description: "Id milik siswa lain -> 404.",
  action: "leave.self.read",
  params: leaveIdParams,
  response: leaveRequestSchema,
});

export const cancelOwnLeaveContract = defineContract({
  id: "cancelOwnLeaveRequest",
  method: "POST",
  path: "/api/v1/student/leave-requests/{id}/cancel",
  tag: TAG,
  summary: "Batalkan pengajuan yang masih Menunggu",
  description: "Hanya pengajuan milik sendiri berstatus PENDING (409 LEAVE_NOT_PENDING). Lampiran dimusnahkan (unduhan -> 410 FILE_PURGED). Id milik siswa lain -> 404.",
  action: "leave.self",
  params: leaveIdParams,
  response: leaveRequestSchema,
  errors: ["LEAVE_NOT_PENDING"],
});

export const listSchoolLeavesContract = defineContract({
  id: "listSchoolLeaveRequests",
  method: "GET",
  path: "/api/v1/school/leave-requests",
  tag: TAG,
  summary: "Antrean & riwayat izin/sakit sekolah",
  description: `Default status=PENDING (terlama dulu); status lain atau ALL terbaru dulu. from/to = izin yang beririsan dengan rentang. q = nama memuat / awalan NIS. ${SCOPE_NOTE}`,
  action: "leave.review",
  query: schoolLeavesQuery,
  response: z.array(schoolLeaveSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const getSchoolLeaveContract = defineContract({
  id: "getSchoolLeaveRequest",
  method: "GET",
  path: "/api/v1/school/leave-requests/{id}",
  tag: TAG,
  summary: "Detail izin/sakit + hari sekolah dalam rentang",
  description: `Lampiran diunduh lewat GET /api/v1/files/{attachmentFileId}. ${SCOPE_NOTE}`,
  action: "leave.review",
  params: leaveIdParams,
  query: schoolIdQuery,
  response: schoolLeaveDetailSchema,
  errors: ["SCHOOL_NOT_FOUND"],
});

export const approveLeaveContract = defineContract({
  id: "approveSchoolLeaveRequest",
  method: "POST",
  path: "/api/v1/school/leave-requests/{id}/approve",
  tag: TAG,
  summary: "Setujui izin/sakit",
  description: `Body JSON boleh {} (Content-Type application/json wajib). Hanya PENDING (409 LEAVE_ALREADY_REVIEWED) dan siswa Aktif (409 LEAVE_STUDENT_INACTIVE). ${MATERIALIZE_NOTE} Siswa menerima notifikasi LEAVE_APPROVED. ${SCOPE_NOTE}`,
  action: "leave.review",
  params: leaveIdParams,
  query: schoolIdQuery,
  body: approveLeaveBody,
  response: leaveDecisionSchema,
  errors: ["LEAVE_ALREADY_REVIEWED", "LEAVE_STUDENT_INACTIVE", "CONFLICT_RETRY", "SCHOOL_NOT_FOUND"],
});

export const rejectLeaveContract = defineContract({
  id: "rejectSchoolLeaveRequest",
  method: "POST",
  path: "/api/v1/school/leave-requests/{id}/reject",
  tag: TAG,
  summary: "Tolak izin/sakit (alasan wajib)",
  description: `Hanya PENDING (409 LEAVE_ALREADY_REVIEWED). Data absensi tidak diubah. Siswa menerima notifikasi LEAVE_REJECTED berisi alasan. ${SCOPE_NOTE}`,
  action: "leave.review",
  params: leaveIdParams,
  query: schoolIdQuery,
  body: rejectLeaveBody,
  response: schoolLeaveSchema,
  errors: ["LEAVE_ALREADY_REVIEWED", "SCHOOL_NOT_FOUND"],
});

export const createLeaveOnBehalfContract = defineContract({
  id: "createSchoolLeaveRequest",
  method: "POST",
  path: "/api/v1/school/leave-requests",
  tag: TAG,
  summary: "Catat izin/sakit atas nama siswa (langsung disetujui, multipart)",
  description: `Tanggal mulai paling awal hari ini - 30. ${RANGE_RULES} Siswa wajib Aktif (409 LEAVE_STUDENT_INACTIVE). ${MATERIALIZE_NOTE} ${SCOPE_NOTE}`,
  action: "leave.review",
  query: schoolIdQuery,
  body: createLeaveOnBehalfBody,
  bodyType: "multipart",
  maxBodyBytes: LEAVE_MAX_BODY_BYTES,
  response: leaveDecisionSchema,
  successStatus: 201,
  errors: [...RANGE_ERRORS, ...UPLOAD_ERRORS, "LEAVE_STUDENT_INACTIVE", "CONFLICT_RETRY", "SCHOOL_NOT_FOUND", "RATE_LIMITED"],
});

export const attendanceLeaveContracts: readonly AnyContract[] = [
  listOwnLeavesContract,
  createOwnLeaveContract,
  getOwnLeaveContract,
  cancelOwnLeaveContract,
  listSchoolLeavesContract,
  createLeaveOnBehalfContract,
  getSchoolLeaveContract,
  approveLeaveContract,
  rejectLeaveContract,
];
