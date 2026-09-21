import type { SchoolTimezone } from "@prisma/client";
import { requirePrincipal, type ActionContext } from "@/lib/auth/principal";
import type { Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { resolveSchoolScope, type SchoolScope } from "@/lib/tenant/scope";
import { localParts, type LocalDate } from "@/lib/time/zone";
import { periodKeyOfDate } from "./period-rules";

/** Konteks sekolah untuk domain SPP: cakupan tenant, zona waktu, identitas & rekening sekolah. */
export interface BillingSchool {
  readonly id: string;
  readonly name: string;
  readonly npsn: string | null;
  readonly address: string | null;
  readonly timezone: SchoolTimezone;
  readonly bankName: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankAccountHolder: string | null;
  readonly bankChangedAt: Date | null;
}

const SCHOOL_SELECT = {
  id: true, name: true, npsn: true, address: true, timezone: true,
  bankName: true, bankAccountNumber: true, bankAccountHolder: true, bankChangedAt: true,
} as const;

/** SCHOOL_ADMIN: sekolahnya (schoolId lain -> 403); SUPER_ADMIN: wajib ?schoolId (400). */
export function billingScopeOf(ctx: ActionContext, schoolId: string | undefined): SchoolScope {
  return resolveSchoolScope(requirePrincipal(ctx), schoolId);
}

/** Sekolah dalam cakupan wajib ada (SUPER_ADMIN bisa menyebut id sembarang) -> 404 SCHOOL_NOT_FOUND. */
export async function loadBillingSchool(db: Tx, schoolId: string): Promise<BillingSchool> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: SCHOOL_SELECT });
  if (!school) throw notFound("Sekolah tidak ditemukan.", "SCHOOL_NOT_FOUND");
  return school;
}

export interface SchoolClock {
  readonly today: LocalDate;
  readonly todayKey: number;
  /** Tahun lokal untuk penomoran dokumen (INV-/KWT-YYYY). */
  readonly year: number;
}

export function schoolClock(school: Pick<BillingSchool, "timezone">, now: Date): SchoolClock {
  const parts = localParts(now, school.timezone);
  return { today: parts.ymd, todayKey: periodKeyOfDate(parts.ymd), year: parts.year };
}
