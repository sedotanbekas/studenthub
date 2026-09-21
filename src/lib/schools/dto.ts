import type { Prisma } from "@prisma/client";
import { fromDbDate } from "@/lib/time/zone";
import { scheduleLabels, schoolDayCodes, type SchoolSnapshot } from "./rules";
import type { SchoolDto } from "./schemas";

/** Relasi yang selalu dimuat untuk DTO sekolah. */
export const SCHOOL_INCLUDE = {
  province: { select: { code: true, name: true } },
  city: { select: { code: true, name: true } },
} as const satisfies Prisma.SchoolInclude;

export type SchoolRow = Prisma.SchoolGetPayload<{ include: typeof SCHOOL_INCLUDE }>;

const isoOrNull = (value: Date | null): string | null => (value ? value.toISOString() : null);

/** Baris Prisma -> nilai murni untuk aturan (koordinat Decimal -> number). */
export function toSnapshot(row: SchoolRow): SchoolSnapshot {
  return {
    name: row.name,
    npsn: row.npsn,
    address: row.address,
    provinceCode: row.provinceCode,
    cityCode: row.cityCode,
    latitude: row.latitude.toNumber(),
    longitude: row.longitude.toNumber(),
    geofenceRadiusM: row.geofenceRadiusM,
    timezone: row.timezone,
    checkInOpenMinute: row.checkInOpenMinute,
    startMinute: row.startMinute,
    lateToleranceMinutes: row.lateToleranceMinutes,
    checkInCloseMinute: row.checkInCloseMinute,
    dayEndMinute: row.dayEndMinute,
    schoolDaysMask: row.schoolDaysMask,
    bankName: row.bankName,
    bankAccountNumber: row.bankAccountNumber,
    bankAccountHolder: row.bankAccountHolder,
  };
}

export function toSchoolDto(row: SchoolRow): SchoolDto {
  const snapshot = toSnapshot(row);
  return {
    id: row.id,
    npsn: row.npsn,
    name: row.name,
    address: row.address,
    province: { code: row.province.code, name: row.province.name },
    city: { code: row.city.code, name: row.city.name },
    latitude: snapshot.latitude,
    longitude: snapshot.longitude,
    geofenceRadiusM: row.geofenceRadiusM,
    geofenceUpdatedAt: isoOrNull(row.geofenceUpdatedAt),
    timezone: row.timezone,
    checkInOpenMinute: row.checkInOpenMinute,
    startMinute: row.startMinute,
    lateToleranceMinutes: row.lateToleranceMinutes,
    checkInCloseMinute: row.checkInCloseMinute,
    dayEndMinute: row.dayEndMinute,
    schoolDaysMask: row.schoolDaysMask,
    schedule: scheduleLabels(row),
    schoolDays: schoolDayCodes(row.schoolDaysMask),
    bankName: row.bankName,
    bankAccountNumber: row.bankAccountNumber,
    bankAccountHolder: row.bankAccountHolder,
    bankChangedAt: isoOrNull(row.bankChangedAt),
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ActiveTermRow = {
  id: string;
  semester: "GANJIL" | "GENAP";
  startDate: Date;
  endDate: Date;
  academicYearId: string;
  academicYear: { name: string };
};

const SEMESTER_LABEL = { GANJIL: "Ganjil", GENAP: "Genap" } as const;

export function toActiveTermDto(term: ActiveTermRow | null): {
  id: string;
  label: string;
  semester: "GANJIL" | "GENAP";
  academicYearId: string;
  academicYearName: string;
  startDate: string;
  endDate: string;
} | null {
  if (!term) return null;
  return {
    id: term.id,
    label: `Semester ${SEMESTER_LABEL[term.semester]} ${term.academicYear.name}`,
    semester: term.semester,
    academicYearId: term.academicYearId,
    academicYearName: term.academicYear.name,
    startDate: fromDbDate(term.startDate),
    endDate: fromDbDate(term.endDate),
  };
}
