import { z } from "zod";
import { schoolIdQuery } from "@/lib/academics/schema-common";
import { defineContract, type AnyContract } from "@/lib/http/contract";
import { MAX_BULK_GRADE_ROWS, MAX_CARD_GRADE_ROWS, MAX_PUBLISH_BATCH, MAX_UNPUBLISH_BATCH } from "./constants";
import {
  bulkGradesBody,
  bulkGradesResultSchema,
  cardGradesBody,
  createReportCardBody,
  deletedReportCardSchema,
  listReportCardsQuery,
  ownReportCardDetailSchema,
  ownReportCardItemSchema,
  publishBody,
  publishResultSchema,
  readinessQuery,
  readinessSchema,
  reportCardDetailSchema,
  reportCardIdParams,
  reportCardListItemSchema,
  sheetQuery,
  sheetSchema,
  unpublishBody,
  unpublishResultSchema,
} from "./schemas";

/** Kontrak route rapor: /school/report-cards* (admin) & /student/report-cards* (siswa). */
const TAG = "Rapor";
const SCOPE_NOTE = "Admin sekolah: sekolahnya sendiri. Super admin: wajib ?schoolId=. Id milik sekolah lain -> 404.";
const PREDICATE_NOTE = "Nilai bilangan bulat 0-100. Predikat K13 relatif KKM: A bila 3·nilai >= KKM+200, B bila 3·nilai >= 2·KKM+100, C bila nilai >= KKM, selain itu D.";
const ROW_ERRORS_NOTE = "Semua-atau-tidak: satu baris salah -> 400 GRADE_ROWS_INVALID dengan details.rowErrors[{index, studentId|subjectId, code, message}] dan tidak ada yang ditulis.";
const TERM_CLASS_ERRORS = ["CLASS_TERM_MISMATCH"] as const;

export const gradeSheetContract = defineContract({
  id: "getReportCardGradeSheet",
  method: "GET",
  path: "/api/v1/school/report-cards/sheet",
  tag: TAG,
  summary: "Grid nilai satu kelas & satu mapel",
  description: `Baris = siswa AKTIF kelas ini + siswa yang sudah punya rapor kelas & semester ini, urut nama. Tahun ajaran kelas wajib = tahun ajaran semester (422 CLASS_TERM_MISMATCH); mapel wajib dipetakan ke kelas (422 SUBJECT_NOT_IN_CLASS). ${SCOPE_NOTE}`,
  action: "reportCards.read",
  query: sheetQuery,
  response: sheetSchema,
  errors: [...TERM_CLASS_ERRORS, "SUBJECT_NOT_IN_CLASS"],
});

export const bulkGradesContract = defineContract({
  id: "upsertReportCardGrades",
  method: "PUT",
  path: "/api/v1/school/report-cards/grades",
  tag: TAG,
  summary: "Input nilai massal per kelas & mapel",
  description: `Maks ${MAX_BULK_GRADE_ROWS} baris. ${PREDICATE_NOTE} score null menghapus nilai. ${ROW_ERRORS_NOTE} Kode baris: DUPLICATE_STUDENT, STUDENT_NOT_ELIGIBLE, REPORT_CARD_OTHER_CLASS. Rapor terbit di antara target -> 409 REPORT_CARD_PUBLISHED {studentIds}. Rapor DRAFT dibuat otomatis untuk siswa yang belum punya. ${SCOPE_NOTE}`,
  action: "reportCards.manage",
  query: schoolIdQuery,
  body: bulkGradesBody,
  response: bulkGradesResultSchema,
  errors: ["GRADE_ROWS_INVALID", "REPORT_CARD_PUBLISHED", ...TERM_CLASS_ERRORS, "SUBJECT_NOT_IN_CLASS"],
});

export const listReportCardsContract = defineContract({
  id: "listReportCards",
  method: "GET",
  path: "/api/v1/school/report-cards",
  tag: TAG,
  summary: "Daftar rapor satu semester",
  description: `Default semester aktif. Urut kelas lalu nama siswa. q = nama memuat / awalan NIS. ${SCOPE_NOTE}`,
  action: "reportCards.read",
  query: listReportCardsQuery,
  response: z.array(reportCardListItemSchema),
  pagination: "page",
  errors: ["SCHOOL_NOT_FOUND"],
});

export const createReportCardContract = defineContract({
  id: "createReportCard",
  method: "POST",
  path: "/api/v1/school/report-cards",
  tag: TAG,
  summary: "Buat rapor DRAFT kosong untuk satu siswa",
  description: `Siswa wajib AKTIF dan sudah ditempatkan di kelas (422 STUDENT_NOT_ELIGIBLE); kelas rapor = kelas siswa saat ini. Satu rapor per siswa per semester (409 REPORT_CARD_EXISTS). ${SCOPE_NOTE}`,
  action: "reportCards.manage",
  query: schoolIdQuery,
  body: createReportCardBody,
  response: reportCardDetailSchema,
  successStatus: 201,
  errors: ["STUDENT_NOT_ELIGIBLE", "REPORT_CARD_EXISTS", "STUDENT_STATE_CHANGED", ...TERM_CLASS_ERRORS],
});

export const readinessContract = defineContract({
  id: "getReportCardReadiness",
  method: "GET",
  path: "/api/v1/school/report-cards/readiness",
  tag: TAG,
  summary: "Kesiapan terbit rapor satu kelas",
  description: `ready = DRAFT lengkap semua mapel terpetakan; incomplete = DRAFT dengan missingSubjectIds; noReportCard = siswa AKTIF kelas ini tanpa rapor semester ini; published = sudah terbit. Kelas tanpa mapel -> 422 CLASS_HAS_NO_SUBJECTS. ${SCOPE_NOTE}`,
  action: "reportCards.read",
  query: readinessQuery,
  response: readinessSchema,
  errors: [...TERM_CLASS_ERRORS, "CLASS_HAS_NO_SUBJECTS"],
});

export const publishContract = defineContract({
  id: "publishReportCards",
  method: "POST",
  path: "/api/v1/school/report-cards/publish",
  tag: TAG,
  summary: "Terbitkan rapor satu kelas",
  description: `Tanpa studentIds: semua rapor DRAFT kelas + siswa AKTIF tanpa rapor wajib lengkap; dengan studentIds (maks ${MAX_PUBLISH_BATCH}): hanya siswa itu. Semua-atau-tidak: ada yang belum lengkap -> 422 REPORT_CARD_INCOMPLETE {incomplete[{reportCardId|null, studentId, missingSubjectIds}]}. Snapshot nama mapel, KKM, predikat, dan rekap sakit/izin/alpha (awal semester s.d. min(akhir semester, hari tertutup terakhir)) dibekukan. Rapor yang sudah terbit dilewati. Siswa menerima notifikasi REPORT_CARD_PUBLISHED. ${SCOPE_NOTE}`,
  action: "reportCards.publish",
  query: schoolIdQuery,
  body: publishBody,
  response: publishResultSchema,
  errors: ["REPORT_CARD_INCOMPLETE", "CLASS_HAS_NO_SUBJECTS", "STATE_CONFLICT", ...TERM_CLASS_ERRORS],
});

export const unpublishContract = defineContract({
  id: "unpublishReportCards",
  method: "POST",
  path: "/api/v1/school/report-cards/unpublish",
  tag: TAG,
  summary: "Tarik terbit rapor (kembali ke DRAFT)",
  description: `Maks ${MAX_UNPUBLISH_BATCH} rapor, alasan wajib 5-255 karakter (dicatat di audit). Semua wajib berstatus terbit (409 REPORT_CARD_NOT_PUBLISHED {reportCardIds}). Tanpa notifikasi; siswa mendapat 404 untuk rapor itu sampai diterbitkan lagi. ${SCOPE_NOTE}`,
  action: "reportCards.publish",
  query: schoolIdQuery,
  body: unpublishBody,
  response: unpublishResultSchema,
  errors: ["REPORT_CARD_NOT_PUBLISHED", "STATE_CONFLICT"],
});

export const getReportCardContract = defineContract({
  id: "getReportCard",
  method: "GET",
  path: "/api/v1/school/report-cards/{id}",
  tag: TAG,
  summary: "Detail rapor",
  description: `DRAFT: nama mapel/KKM/predikat dari mapel terkini, missingSubjectIds, rekap kehadiran dihitung langsung. PUBLISHED: snapshot. ${SCOPE_NOTE}`,
  action: "reportCards.read",
  params: reportCardIdParams,
  query: schoolIdQuery,
  response: reportCardDetailSchema,
});

export const deleteReportCardContract = defineContract({
  id: "deleteReportCard",
  method: "DELETE",
  path: "/api/v1/school/report-cards/{id}",
  tag: TAG,
  summary: "Hapus rapor DRAFT (nilai ikut terhapus)",
  description: `Rapor terbit -> 409 REPORT_CARD_PUBLISHED. ${SCOPE_NOTE}`,
  action: "reportCards.manage",
  params: reportCardIdParams,
  query: schoolIdQuery,
  response: deletedReportCardSchema,
  errors: ["REPORT_CARD_PUBLISHED", "STATE_CONFLICT"],
});

export const cardGradesContract = defineContract({
  id: "upsertSingleReportCardGrades",
  method: "PUT",
  path: "/api/v1/school/report-cards/{id}/grades",
  tag: TAG,
  summary: "Input nilai satu rapor",
  description: `Maks ${MAX_CARD_GRADE_ROWS} mapel; mapel wajib dipetakan ke kelas rapor atau sudah dinilai di rapor ini. ${PREDICATE_NOTE} score null menghapus nilai. ${ROW_ERRORS_NOTE} Kode baris: DUPLICATE_SUBJECT, SUBJECT_NOT_IN_CLASS. Rapor terbit -> 409 REPORT_CARD_PUBLISHED. ${SCOPE_NOTE}`,
  action: "reportCards.manage",
  params: reportCardIdParams,
  query: schoolIdQuery,
  body: cardGradesBody,
  response: reportCardDetailSchema,
  errors: ["GRADE_ROWS_INVALID", "REPORT_CARD_PUBLISHED"],
});

const SELF_NOTE = "Hanya rapor TERBIT milik siswa sendiri (DRAFT, ditarik, atau milik siswa lain -> 404). Siswa Aktif & Lulus.";

export const listOwnReportCardsContract = defineContract({
  id: "listOwnReportCards",
  method: "GET",
  path: "/api/v1/student/report-cards",
  tag: TAG,
  summary: "Daftar rapor terbit milik siswa",
  description: `Semester terbaru dulu. ${SELF_NOTE}`,
  action: "reportCards.self.read",
  response: z.array(ownReportCardItemSchema),
});

export const getOwnReportCardContract = defineContract({
  id: "getOwnReportCard",
  method: "GET",
  path: "/api/v1/student/report-cards/{id}",
  tag: TAG,
  summary: "Detail rapor terbit milik siswa",
  description: `Nilai, KKM, predikat, deskripsi, dan rekap sakit/izin/alpha dari snapshot saat terbit. ${SELF_NOTE}`,
  action: "reportCards.self.read",
  params: reportCardIdParams,
  response: ownReportCardDetailSchema,
});

export const reportCardsContracts: readonly AnyContract[] = [
  gradeSheetContract,
  bulkGradesContract,
  listReportCardsContract,
  createReportCardContract,
  readinessContract,
  publishContract,
  unpublishContract,
  getReportCardContract,
  deleteReportCardContract,
  cardGradesContract,
  listOwnReportCardsContract,
  getOwnReportCardContract,
];
