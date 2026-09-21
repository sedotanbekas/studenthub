import { addDays, instantAtLocal, localParts, type SchoolTz } from "@/lib/time/zone";
import type { StudentStatusValue } from "./constants";

export type NisnClaimDecision = "CLAIM" | "RELEASE_AND_CLAIM" | "CONFLICT";

export interface NisnHolder {
  readonly id: string;
  readonly status: StudentStatusValue;
}

/**
 * Keputusan klaim activeNisn (murni). Pemegang LULUS di sekolah lain dilepas; pemegang AKTIF/NONAKTIF
 * menolak klaim (sekolah asal harus menandai Pindah/Lulus). `selfId` null = siswa belum dibuat.
 */
export function decideNisnClaim(holder: NisnHolder | null, selfId: string | null): NisnClaimDecision {
  if (holder === null || holder.id === selfId) return "CLAIM";
  if (holder.status === "GRADUATED") return "RELEASE_AND_CLAIM";
  return "CONFLICT";
}

/**
 * Kuota pelepasan NISN lintas sekolah (murni). Sekolah PENGKLAIM (bukan super admin) paling banyak
 * melepas NISN_RELEASE_DAILY_LIMIT NISN siswa LULUS di sekolah lain per hari lokal sekolah itu.
 */
export const NISN_RELEASE_DAILY_LIMIT = 20;

export function isReleaseQuotaExempt(role: string | null | undefined): boolean {
  return role === "SUPER_ADMIN";
}

/** Jumlah NISN pada satu audit `student.nisn_release_claimed` (after.count); data tak sah dihitung 1. */
export function claimedCountOf(after: unknown): number {
  const count = typeof after === "object" && after !== null ? (after as { count?: unknown }).count : undefined;
  return typeof count === "number" && Number.isInteger(count) && count > 0 ? count : 1;
}

export interface ReleaseQuotaVerdict {
  readonly allowed: boolean;
  readonly used: number;
  readonly remaining: number;
}

export function releaseQuotaVerdict(used: number, requested: number, limit: number = NISN_RELEASE_DAILY_LIMIT): ReleaseQuotaVerdict {
  const remaining = Math.max(0, limit - used);
  return { allowed: requested <= remaining, used, remaining };
}

/** Rentang [start, end) instant UTC untuk hari lokal sekolah yang memuat `now`. */
export function localDayWindow(now: Date, tz: SchoolTz): { readonly start: Date; readonly end: Date } {
  const today = localParts(now, tz).ymd;
  return { start: instantAtLocal(today, 0, tz), end: instantAtLocal(addDays(today, 1), 0, tz) };
}
