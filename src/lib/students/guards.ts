import { generateTempPassword, hashPassword, TEMP_PASSWORD_BCRYPT_COST, TEMP_PASSWORD_TTL_MS } from "@/lib/auth/password";
import type { Tx } from "@/lib/db";
import { conflict, unprocessable, type AppError } from "@/lib/http/errors";
import type { SchoolScope } from "@/lib/tenant/scope";
import type { ActivationGap } from "./activation-rules";
import { NISN_ACTIVE_ELSEWHERE_MESSAGE } from "./nisn-claim";
import { findClassInSchool, type ClassRef } from "./records";
import { uniqueIndexOf } from "./unique-error";

/** Pemeriksaan & error bersama service siswa. */
export const NISN_IN_SCHOOL_MESSAGE = "NISN sudah terdaftar di sekolah ini.";
export const NIS_IN_SCHOOL_MESSAGE = "NIS sudah dipakai siswa lain di sekolah ini.";

export function activationIncomplete(gaps: readonly ActivationGap[]): AppError {
  return unprocessable("ACTIVATION_INCOMPLETE", "Data wajib aktivasi belum lengkap.", { gaps });
}

/** Kelas baru untuk siswa: wajib milik sekolah (404 CLASS_NOT_FOUND) dan aktif (422 CLASS_INACTIVE). */
export async function resolveAssignableClass(db: Tx, scope: SchoolScope, classId: string | null): Promise<ClassRef | null> {
  if (classId === null) return null;
  const klass = await findClassInSchool(db, scope, classId);
  if (!klass.isActive) throw unprocessable("CLASS_INACTIVE", "Kelas sudah dinonaktifkan; pilih kelas aktif.");
  return klass;
}

/** Keunikan NISN & NIS per sekolah (409); `excludeId` = siswa yang sedang diedit. */
export async function assertIdentityFree(
  db: Tx,
  scope: SchoolScope,
  identity: { readonly nisn?: string; readonly nis?: string },
  excludeId?: string,
): Promise<void> {
  const notSelf = excludeId ? { id: { not: excludeId } } : {};
  if (identity.nisn !== undefined) {
    const dup = await db.student.findFirst({ where: { schoolId: scope.schoolId, nisn: identity.nisn, ...notSelf }, select: { id: true } });
    if (dup) throw conflict("NISN_ALREADY_IN_SCHOOL", NISN_IN_SCHOOL_MESSAGE);
  }
  if (identity.nis !== undefined) {
    const dup = await db.student.findFirst({ where: { schoolId: scope.schoolId, nis: identity.nis, ...notSelf }, select: { id: true } });
    if (dup) throw conflict("NIS_ALREADY_IN_SCHOOL", NIS_IN_SCHOOL_MESSAGE);
  }
}

/** P2002 pada indeks unik Student -> 409 dengan kode domain; error lain dikembalikan null. */
export function studentUniqueConflict(error: unknown): AppError | null {
  const index = uniqueIndexOf(error);
  if (index === null) return null;
  if (/activeNisn/.test(index)) return conflict("NISN_ACTIVE_ELSEWHERE", NISN_ACTIVE_ELSEWHERE_MESSAGE);
  if (/schoolId_nisn_key|schoolId,nisn$/.test(index)) return conflict("NISN_ALREADY_IN_SCHOOL", NISN_IN_SCHOOL_MESSAGE);
  if (/schoolId_nis_key|schoolId,nis$/.test(index)) return conflict("NIS_ALREADY_IN_SCHOOL", NIS_IN_SCHOOL_MESSAGE);
  return null;
}

export async function withStudentConflicts<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw studentUniqueConflict(error) ?? error;
  }
}

export interface TemporaryCredential {
  readonly plain: string;
  readonly hash: string;
  readonly expiresAt: Date;
}

/** Kata sandi sementara hasil generate (cost 8, kedaluwarsa 14 hari). Di-hash SEBELUM transaksi. */
export async function issueTemporaryPassword(now: Date): Promise<TemporaryCredential> {
  const plain = generateTempPassword();
  const hash = await hashPassword(plain, TEMP_PASSWORD_BCRYPT_COST);
  return { plain, hash, expiresAt: new Date(now.getTime() + TEMP_PASSWORD_TTL_MS) };
}
