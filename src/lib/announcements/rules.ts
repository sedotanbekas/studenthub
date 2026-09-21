import type { AnnouncementAudience, AnnouncementStatus, Prisma } from "@prisma/client";
import { MAX_CLASS_TARGETS, MAX_STUDENT_TARGETS } from "./constants";

/** Aturan murni pengumuman (tanpa Prisma runtime): audiens, target, penerima, transisi status. */

export interface AudienceInput {
  readonly audience: AnnouncementAudience;
  readonly classIds?: readonly string[];
  readonly studentIds?: readonly string[];
}

/** Audiens ternormalisasi: id unik, daftar yang tidak relevan selalu kosong. */
export interface NormalizedAudience {
  readonly audience: AnnouncementAudience;
  readonly classIds: readonly string[];
  readonly studentIds: readonly string[];
}

export interface AudienceIssue {
  readonly field: "classIds" | "studentIds";
  readonly message: string;
}

const unique = (values: readonly string[] | undefined): string[] => [...new Set(values ?? [])];

function requireTargets(ids: readonly string[], max: number, field: AudienceIssue["field"], label: string): AudienceIssue | null {
  if (ids.length === 0) return { field, message: `Pilih minimal 1 ${label}.` };
  if (ids.length > max) return { field, message: `Maksimal ${max} ${label} per pengumuman.` };
  return null;
}

/**
 * ALL: tanpa target. CLASSES: 1..50 kelas unik, tanpa siswa. STUDENTS: 1..500 siswa unik, tanpa kelas.
 * Duplikat dibuang sebelum dihitung. Keanggotaan sekolah dicek service (422 INVALID_TARGETS).
 */
export function validateAudience(input: AudienceInput): AudienceIssue | null {
  const classIds = unique(input.classIds);
  const studentIds = unique(input.studentIds);
  if (input.audience === "ALL") {
    if (classIds.length > 0) return { field: "classIds", message: "Audiens semua siswa tidak boleh memilih kelas." };
    if (studentIds.length > 0) return { field: "studentIds", message: "Audiens semua siswa tidak boleh memilih siswa." };
    return null;
  }
  if (input.audience === "CLASSES") {
    if (studentIds.length > 0) return { field: "studentIds", message: "Audiens per kelas tidak boleh memilih siswa." };
    return requireTargets(classIds, MAX_CLASS_TARGETS, "classIds", "kelas");
  }
  if (classIds.length > 0) return { field: "classIds", message: "Audiens per siswa tidak boleh memilih kelas." };
  return requireTargets(studentIds, MAX_STUDENT_TARGETS, "studentIds", "siswa");
}

/** Salinan ternormalisasi (tidak memutasi input). Panggil setelah validateAudience lolos. */
export function normalizeAudience(input: AudienceInput): NormalizedAudience {
  return {
    audience: input.audience,
    classIds: input.audience === "CLASSES" ? unique(input.classIds) : [],
    studentIds: input.audience === "STUDENTS" ? unique(input.studentIds) : [],
  };
}

/** Id yang diminta tetapi tidak ditemukan (dalam cakupan), urutan permintaan dipertahankan. */
export function invalidTargetIds(requested: readonly string[], found: readonly string[]): string[] {
  const known = new Set(found);
  return requested.filter((id) => !known.has(id));
}

/** Penerima = siswa ACTIVE berakun aktif di sekolah, dipersempit kelas saat ini / id siswa (desain 05 A6). */
export function recipientFilter(schoolId: string, audience: NormalizedAudience): Prisma.StudentWhereInput {
  const base = { schoolId, status: "ACTIVE" as const, user: { isActive: true } };
  if (audience.audience === "CLASSES") return { ...base, currentClassId: { in: [...audience.classIds] } };
  if (audience.audience === "STUDENTS") return { ...base, id: { in: [...audience.studentIds] } };
  return base;
}

export type AnnouncementAction = "edit" | "publish" | "cancel" | "delete";

export interface TransitionViolation {
  readonly code: string;
  readonly message: string;
  readonly status: 409 | 422;
}

/**
 * DRAFT: ubah, terbitkan, batalkan, hapus. PUBLISHED: hanya tarik (cancel -> CANCELLED). CANCELLED: final.
 * Edit setelah terbit & penjadwalan ditunda (PLAN backlog).
 */
export function transitionViolation(status: AnnouncementStatus, action: AnnouncementAction): TransitionViolation | null {
  if (status === "DRAFT") return null;
  if (action === "cancel" && status === "PUBLISHED") return null;
  if (action === "edit") {
    return { code: "ANNOUNCEMENT_NOT_EDITABLE", message: "Pengumuman yang sudah terbit atau ditarik tidak dapat diubah.", status: 422 };
  }
  if (action === "delete") {
    return { code: "ANNOUNCEMENT_NOT_DRAFT", message: "Hanya draf pengumuman yang dapat dihapus.", status: 409 };
  }
  const message = status === "CANCELLED" ? "Pengumuman sudah dibatalkan/ditarik." : "Pengumuman sudah terbit.";
  return { code: "INVALID_STATUS_TRANSITION", message, status: 409 };
}
