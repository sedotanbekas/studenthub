import type { StudentStatus } from "@prisma/client";
import { localParts, type SchoolTz } from "@/lib/time/zone";

/** Aturan murni ringkasan dashboard (tanpa Prisma). */

export interface StudentCounts {
  readonly active: number;
  readonly inactive: number;
  readonly draft: number;
  readonly graduated: number;
  readonly moved: number;
}

const STATUS_KEY: Readonly<Record<StudentStatus, keyof StudentCounts>> = {
  ACTIVE: "active",
  INACTIVE: "inactive",
  DRAFT: "draft",
  GRADUATED: "graduated",
  MOVED: "moved",
};

const EMPTY_COUNTS: StudentCounts = { active: 0, inactive: 0, draft: 0, graduated: 0, moved: 0 };

/** Hasil groupBy status siswa -> hitungan per status (status tanpa baris = 0). */
export function studentCountsFrom(groups: ReadonlyArray<{ readonly status: StudentStatus; readonly count: number }>): StudentCounts {
  return groups.reduce<StudentCounts>((acc, group) => {
    const key = STATUS_KEY[group.status];
    return { ...acc, [key]: acc[key] + group.count };
  }, EMPTY_COUNTS);
}

/** Periode tagihan (tahun & bulan) berjalan menurut zona waktu sekolah. */
export function localPeriodFor(now: Date, timezone: SchoolTz): { periodYear: number; periodMonth: number } {
  const parts = localParts(now, timezone);
  return { periodYear: parts.year, periodMonth: parts.month };
}
