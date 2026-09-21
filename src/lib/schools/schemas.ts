import { z } from "zod";
import { pageQuerySchema } from "@/lib/http/pagination";
import { DAY_CODES, SCHOOL_TIMEZONES } from "./rules";

/**
 * Skema zod domain sekolah. Zod hanya memeriksa BENTUK (tipe, panjang teks); aturan konfigurasi
 * (rentang koordinat, urutan jadwal, radius, mask, rekening) diperiksa validateSchoolConfig pada
 * hasil merge -> 422 SCHOOL_CONFIG_INVALID.
 */
export const idParams = z.object({ id: z.string().trim().min(1).max(64).meta({ description: "ID sekolah." }) });

export const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

/** Query /school/*: SUPER_ADMIN wajib menyebut schoolId; admin sekolah boleh mengosongkan. */
export const schoolScopeQuery = z.object({
  schoolId: z.string().trim().min(1).max(64).optional().meta({ description: "Wajib untuk SUPER_ADMIN; admin sekolah memakai sekolahnya sendiri." }),
});

const minute = (description: string) => z.int().meta({ description: `${description} (menit sejak 00:00 waktu lokal sekolah).` });
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const scheduleShape = {
  checkInOpenMinute: minute("Jam buka absensi").optional(),
  startMinute: minute("Jam masuk").optional(),
  lateToleranceMinutes: z.int().optional().meta({ description: "Toleransi terlambat 0..120 menit." }),
  checkInCloseMinute: minute("Jam tutup absensi").optional(),
  dayEndMinute: minute("Akhir hari sekolah; setelah ini auto-ALPHA berjalan").optional(),
  schoolDaysMask: z.int().optional().meta({ description: "Bitmask hari sekolah: Sen=1 Sel=2 Rab=4 Kam=8 Jum=16 Sab=32 Min=64." }),
};

const bankShape = {
  bankName: optionalText(50).meta({ description: "Nama bank tujuan transfer SPP (null = hapus rekening)." }),
  bankAccountNumber: z.string().trim().min(1).max(64).nullable().optional().meta({ description: "5..30 digit angka." }),
  bankAccountHolder: optionalText(100),
};

const identityShape = {
  npsn: z.string().trim().min(1).max(16).nullable().optional().meta({ description: "NPSN 8 digit (opsional, unik)." }),
  address: optionalText(500),
};

const nonEmpty = (value: object): boolean => Object.values(value).some((v) => v !== undefined);
const NON_EMPTY_MESSAGE = { message: "Minimal satu kolom harus diubah." };

export const createSchoolBody = z.strictObject({
  ...identityShape,
  name: z.string().trim().min(3).max(150),
  provinceCode: z.string().regex(/^\d{2}$/, "Kode provinsi harus 2 digit."),
  cityCode: z.string().regex(/^\d{2}\.\d{2}$/, "Kode kabupaten/kota berformat 00.00."),
  latitude: z.number().meta({ description: "Lintang titik pusat geofence (-11.5..6.5)." }),
  longitude: z.number().meta({ description: "Bujur titik pusat geofence (94.5..141.5)." }),
  geofenceRadiusM: z.int().optional().meta({ description: "Radius geofence 50..1000 m (default 150)." }),
  timezone: z.enum(SCHOOL_TIMEZONES),
  ...scheduleShape,
  ...bankShape,
});
export type CreateSchoolInput = z.output<typeof createSchoolBody>;

export const updateSchoolBody = z
  .strictObject({
    ...identityShape,
    name: z.string().trim().min(3).max(150).optional(),
    provinceCode: z.string().regex(/^\d{2}$/, "Kode provinsi harus 2 digit.").optional(),
    cityCode: z.string().regex(/^\d{2}\.\d{2}$/, "Kode kabupaten/kota berformat 00.00.").optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    geofenceRadiusM: z.int().optional(),
    timezone: z.enum(SCHOOL_TIMEZONES).optional(),
    ...scheduleShape,
    ...bankShape,
  })
  .refine(nonEmpty, NON_EMPTY_MESSAGE);
export type UpdateSchoolInput = z.output<typeof updateSchoolBody>;

/** Admin sekolah HANYA boleh mengubah jadwal & hari sekolah (kunci lain -> 400). */
export const updateSchoolSettingsBody = z.strictObject(scheduleShape).refine(nonEmpty, NON_EMPTY_MESSAGE);
export type UpdateSchoolSettingsInput = z.output<typeof updateSchoolSettingsBody>;

export const deactivateSchoolBody = z.strictObject({
  reason: z.string().trim().min(3).max(255).meta({ description: "Alasan penonaktifan (dicatat di audit)." }),
});

export const listSchoolsQuery = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().meta({ description: "Cari nama sekolah atau awalan NPSN." }),
  provinceCode: z.string().regex(/^\d{2}$/, "Kode provinsi harus 2 digit.").optional(),
  cityCode: z.string().regex(/^\d{2}\.\d{2}$/, "Kode kabupaten/kota berformat 00.00.").optional(),
  isActive: booleanQuery.optional(),
});
export type ListSchoolsQuery = z.output<typeof listSchoolsQuery>;

// ----------------------------------------------------------------------------- respons

const iso = z.iso.datetime();
const regionRef = z.object({ code: z.string(), name: z.string() });

export const scheduleLabelsSchema = z
  .object({ checkInOpen: z.string(), start: z.string(), lateAfter: z.string(), checkInClose: z.string(), dayEnd: z.string() })
  .meta({ description: "Jadwal dalam format HH:mm waktu lokal; lateAfter = batas akhir tepat waktu (masuk + toleransi)." });

export const schoolSchema = z
  .object({
    id: z.string(),
    npsn: z.string().nullable(),
    name: z.string(),
    address: z.string().nullable(),
    province: regionRef,
    city: regionRef,
    latitude: z.number(),
    longitude: z.number(),
    geofenceRadiusM: z.int(),
    geofenceUpdatedAt: iso.nullable(),
    timezone: z.enum(SCHOOL_TIMEZONES),
    checkInOpenMinute: z.int(),
    startMinute: z.int(),
    lateToleranceMinutes: z.int(),
    checkInCloseMinute: z.int(),
    dayEndMinute: z.int(),
    schoolDaysMask: z.int(),
    schedule: scheduleLabelsSchema,
    schoolDays: z.array(z.enum(DAY_CODES)),
    bankName: z.string().nullable(),
    bankAccountNumber: z.string().nullable(),
    bankAccountHolder: z.string().nullable(),
    bankChangedAt: iso.nullable(),
    isActive: z.boolean(),
    createdAt: iso,
    updatedAt: iso,
  })
  .meta({ id: "SchoolInfo" });

export const schoolListItemSchema = z
  .object({
    id: z.string(),
    npsn: z.string().nullable(),
    name: z.string(),
    province: regionRef,
    city: regionRef,
    timezone: z.enum(SCHOOL_TIMEZONES),
    isActive: z.boolean(),
    activeStudentCount: z.int(),
    createdAt: iso,
  })
  .meta({ id: "SchoolListItem" });

export const studentsByStatusSchema = z.object({
  DRAFT: z.int(),
  ACTIVE: z.int(),
  INACTIVE: z.int(),
  GRADUATED: z.int(),
  MOVED: z.int(),
});

export const platformSchoolDetailSchema = schoolSchema
  .extend({ counts: z.object({ studentsByStatus: studentsByStatusSchema, adminCount: z.int(), activeAdminCount: z.int() }) })
  .meta({ id: "PlatformSchoolDetail" });

export const activeTermSchema = z.object({
  id: z.string(),
  label: z.string().meta({ example: "Semester Ganjil 2026/2027" }),
  semester: z.enum(["GANJIL", "GENAP"]),
  academicYearId: z.string(),
  academicYearName: z.string(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
});

export const setupChecklistSchema = z
  .object({
    hasActiveTerm: z.boolean(),
    classCount: z.int().meta({ description: "Kelas aktif pada tahun ajaran semester aktif (semua kelas aktif bila belum ada semester aktif)." }),
    subjectCount: z.int().meta({ description: "Mata pelajaran aktif." }),
    activeStudentCount: z.int(),
    holidayCount: z.int().meta({ description: "Libur milik sekolah ini (tanpa libur nasional)." }),
  })
  .meta({ description: "Urutan onboarding: tahun ajaran -> semester aktif -> kelas -> mapel -> siswa -> libur." });

export const schoolProfileSchema = schoolSchema
  .extend({ activeTerm: activeTermSchema.nullable(), setupChecklist: setupChecklistSchema })
  .meta({ id: "SchoolProfile" });

export const deactivateSchoolResult = z.object({ id: z.string(), isActive: z.boolean(), revokedSessions: z.int() });
export const reactivateSchoolResult = z.object({ id: z.string(), isActive: z.boolean() });

export type SchoolDto = z.input<typeof schoolSchema>;
export type SchoolListItemDto = z.input<typeof schoolListItemSchema>;
export type PlatformSchoolDetailDto = z.input<typeof platformSchoolDetailSchema>;
export type SchoolProfileDto = z.input<typeof schoolProfileSchema>;
