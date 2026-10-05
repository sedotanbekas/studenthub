import type { StudentStatus, UserRole } from "@prisma/client";
import { checkLoginEligibility, type IneligibleReason } from "./principal-rules";

/**
 * "Masuk sebagai" (pemilik 2026-10-05): super admin membuka akun lain — semua peran KECUALI super admin — untuk
 * memverifikasi keluhan tester tanpa mengetahui kata sandinya. Sesi terpisah 30 menit, tidak mengeluarkan sesi asli
 * pemilik akun, tercatat di audit. Aturan murni (tanpa Prisma).
 */
export const IMPERSONATION_TTL_MS = 30 * 60_000;

export interface ImpersonationTarget {
  readonly id: string;
  readonly role: UserRole;
  readonly isActive: boolean;
  readonly schoolActive: boolean | null;
  readonly studentStatus: StudentStatus | null;
}

export type ImpersonationRefusal =
  | { readonly code: "IMPERSONATION_NOT_ALLOWED" }
  | { readonly code: "ACCOUNT_INACTIVE"; readonly reason: IneligibleReason };

/** null = boleh. Akun yang tidak bisa login sendiri (nonaktif, sekolah nonaktif, siswa draf/pindah) juga ditolak. */
export function impersonationRefusal(target: ImpersonationTarget): ImpersonationRefusal | null {
  if (target.role === "SUPER_ADMIN") return { code: "IMPERSONATION_NOT_ALLOWED" };
  const eligible = checkLoginEligibility({
    isActive: target.isActive,
    role: target.role,
    schoolActive: target.schoolActive,
    studentStatus: target.studentStatus,
  });
  return eligible.ok ? null : { code: "ACCOUNT_INACTIVE", reason: eligible.reason };
}

export function impersonationExpiry(now: Date): Date {
  return new Date(now.getTime() + IMPERSONATION_TTL_MS);
}

/** Sesi "Masuk sebagai" hanya berlaku selama pemiliknya masih super admin aktif (dicek setiap request). */
export function impersonatorStillValid(impersonator: { readonly isActive: boolean; readonly role: UserRole } | null): boolean {
  return impersonator !== null && impersonator.isActive && impersonator.role === "SUPER_ADMIN";
}
