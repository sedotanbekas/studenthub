import { z } from "zod";
import { pageQuerySchema } from "@/lib/http/pagination";
import { parseLocalDate } from "@/lib/time/zone";
import {
  ADDRESS_MAX,
  BIRTH_PLACE_MAX,
  GENDERS,
  GUARDIAN_NAME_MAX,
  NAME_MAX,
  NAME_MIN,
  SEARCH_QUERY_MAX,
  SPP_AMOUNT_MAX,
  STATUS_REASON_MAX,
  STATUS_REASON_MIN,
  STUDENT_STATUSES,
  collapseText,
  isValidNis,
  isValidNisn,
} from "./constants";
import { normalizeIdPhone } from "./phone";
import { parseStatusList } from "./search-rules";

/** Skema zod request/response domain siswa (sumber validasi runtime + OpenAPI). */

const ID_MAX = 191;
const idString = z.string().trim().min(1).max(ID_MAX);

export const schoolScopeQuery = z.object({
  schoolId: idString.optional().meta({ description: "Wajib untuk SUPER_ADMIN; diabaikan (harus sama) untuk SCHOOL_ADMIN." }),
});

export const studentIdParams = z.object({ id: idString.meta({ description: "Id siswa." }) });

// ----------------------------------------------------------------------------- field input

const nisnInput = z
  .string()
  .trim()
  .refine(isValidNisn, "NISN harus 10 digit angka.")
  .meta({ example: "0012345678", description: "10 digit; disimpan sebagai teks agar nol depan tetap." });
const nisInput = z.string().trim().refine(isValidNis, "NIS hanya huruf, angka, titik, garis miring, atau tanda hubung (maks 20).");
const nameInput = z
  .string()
  .transform((v) => collapseText(v) ?? "")
  .pipe(z.string().min(NAME_MIN, `Nama minimal ${NAME_MIN} karakter.`).max(NAME_MAX, `Nama maksimal ${NAME_MAX} karakter.`))
  .meta({ minLength: NAME_MIN, maxLength: NAME_MAX });
const genderInput = z.enum(GENDERS);

/** Teks opsional: dirapikan, string kosong -> null, null = kosongkan. */
const optionalText = (max: number, label: string) =>
  z
    .union([z.string(), z.null()])
    .transform((v) => (v === null ? null : collapseText(v)))
    .refine((v) => v === null || v.length <= max, `${label} maksimal ${max} karakter.`);

const birthDateInput = z
  .union([z.string(), z.null()])
  .refine((v) => v === null || v.trim() === "" || parseLocalDate(v.trim()) !== null, "Tanggal lahir harus tanggal valid berformat YYYY-MM-DD.")
  .transform((v) => (v === null || v.trim() === "" ? null : v.trim()))
  .meta({ example: "2012-05-17" });

const guardianPhoneInput = z
  .union([z.string(), z.null()])
  .transform((v, ctx) => {
    const text = v === null ? null : collapseText(v);
    if (text === null) return null;
    const phone = normalizeIdPhone(text);
    if (phone === null) {
      ctx.addIssue({ code: "custom", message: "Nomor HP wali tidak valid (contoh 081234567890)." });
      return z.NEVER;
    }
    return phone;
  })
  .meta({ example: "081234567890", description: "Awalan 08 / 62 / +62; disimpan sebagai +628…" });

const classIdInput = z.union([idString, z.null()]);
const sppAmountInput = z
  .union([z.int().min(0).max(SPP_AMOUNT_MAX, `SPP maksimal ${SPP_AMOUNT_MAX}.`), z.null()])
  .meta({ description: "Tarif SPP per bulan (rupiah). null = tarif default, 0 = bebas SPP." });

/** Opt-in eksplisit pelepasan NISN milik siswa LULUS di sekolah lain (default false -> 409 NISN_HELD_BY_GRADUATE). */
const confirmReleaseInput = z
  .boolean()
  .default(false)
  .meta({
    description:
      "true = setuju melepas NISN yang masih tercatat pada siswa LULUS di sekolah lain (akun lama tidak dapat login; tercatat di audit & dilaporkan ke super admin; kuota 20/hari untuk admin sekolah). false (default) -> 409 NISN_HELD_BY_GRADUATE.",
  });

const studentFields = {
  birthPlace: optionalText(BIRTH_PLACE_MAX, "Tempat lahir").optional(),
  birthDate: birthDateInput.optional(),
  address: optionalText(ADDRESS_MAX, "Alamat").optional(),
  guardianName: optionalText(GUARDIAN_NAME_MAX, "Nama wali").optional(),
  guardianPhone: guardianPhoneInput.optional(),
  currentClassId: classIdInput.optional(),
  sppAmount: sppAmountInput.optional(),
};

export const createStudentBody = z
  .strictObject({
    nisn: nisnInput,
    nis: nisInput,
    name: nameInput,
    gender: genderInput,
    ...studentFields,
    activate: z.boolean().default(true).meta({ description: "true (default) = langsung aktif; false = simpan DRAFT." }),
    confirmReleaseGraduatedNisn: confirmReleaseInput,
  })
  .meta({ id: "CreateStudentInput" });
export type CreateStudentInput = z.output<typeof createStudentBody>;

export const updateStudentBody = z
  .strictObject({
    nisn: nisnInput.optional(),
    nis: nisInput.optional(),
    name: nameInput.optional(),
    gender: genderInput.optional(),
    ...studentFields,
  })
  .refine((v) => Object.values(v).some((field) => field !== undefined), "Tidak ada perubahan yang dikirim.")
  .meta({ id: "UpdateStudentInput" });
export type UpdateStudentInput = z.output<typeof updateStudentBody>;

export const TARGET_STATUSES = ["ACTIVE", "INACTIVE", "GRADUATED", "MOVED"] as const;

export const changeStatusBody = z
  .strictObject({
    to: z.enum(TARGET_STATUSES),
    reason: z
      .string()
      .transform((v) => collapseText(v) ?? "")
      .pipe(z.string().min(STATUS_REASON_MIN, `Alasan minimal ${STATUS_REASON_MIN} karakter.`).max(STATUS_REASON_MAX))
      .meta({ minLength: STATUS_REASON_MIN, maxLength: STATUS_REASON_MAX })
      .optional(),
    confirmReleaseGraduatedNisn: confirmReleaseInput.meta({ description: "Hanya berlaku untuk to=ACTIVE. Lihat ActivateStudentInput." }),
  })
  .superRefine((v, ctx) => {
    if (v.to !== "ACTIVE" && v.reason === undefined) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: `Alasan wajib diisi (${STATUS_REASON_MIN}–${STATUS_REASON_MAX} karakter).` });
    }
  })
  .meta({ id: "ChangeStudentStatusInput" });
export type ChangeStatusInput = z.output<typeof changeStatusBody>;

export const activateStudentBody = z
  .strictObject({ confirmReleaseGraduatedNisn: confirmReleaseInput })
  .meta({ id: "ActivateStudentInput", description: "Body boleh {} (Content-Type application/json wajib)." });
export type ActivateStudentInput = z.output<typeof activateStudentBody>;

// ----------------------------------------------------------------------------- query daftar

export const listStudentsQuery = pageQuerySchema.extend({
  schoolId: schoolScopeQuery.shape.schoolId,
  q: z.string().trim().min(1).max(SEARCH_QUERY_MAX, `Kata kunci maksimal ${SEARCH_QUERY_MAX} karakter.`).optional(),
  classId: idString.optional(),
  status: z
    .string()
    .optional()
    .transform((v, ctx) => {
      const list = parseStatusList(v);
      if (list === null) {
        ctx.addIssue({ code: "custom", message: `status harus daftar koma dari ${STUDENT_STATUSES.join(", ")}.` });
        return z.NEVER;
      }
      return list;
    })
    .meta({ description: "Daftar koma status; default ACTIVE,INACTIVE,DRAFT.", example: "ACTIVE,INACTIVE" }),
  gender: genderInput.optional(),
  sort: z.enum(["name", "nis", "createdAt"]).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});
export type ListStudentsQuery = z.output<typeof listStudentsQuery>;

// ----------------------------------------------------------------------------- respons

const isoInstant = z.string().meta({ format: "date-time" });
const localDate = z.string().meta({ format: "date", example: "2012-05-17" });
const studentStatus = z.enum(STUDENT_STATUSES);

export const activationGapSchema = z
  .object({ field: z.string(), code: z.string(), message: z.string() })
  .meta({ id: "StudentActivationGap" });

export const studentListItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    nisn: z.string(),
    nis: z.string(),
    gender: genderInput,
    status: studentStatus,
    class: z.object({ id: z.string(), name: z.string() }).nullable(),
    sppAmount: z.int().nullable(),
    mustChangePassword: z.boolean(),
    lastLoginAt: isoInstant.nullable(),
  })
  .meta({ id: "StudentListItem" });

export const studentDetailSchema = z
  .object({
    id: z.string(),
    schoolId: z.string(),
    name: z.string(),
    nisn: z.string(),
    nis: z.string(),
    gender: genderInput,
    status: studentStatus,
    birthPlace: z.string().nullable(),
    birthDate: localDate.nullable(),
    address: z.string().nullable(),
    guardianName: z.string().nullable(),
    guardianPhone: z.string().nullable(),
    class: z.object({ id: z.string(), name: z.string(), isActive: z.boolean(), academicYearId: z.string() }).nullable(),
    sppAmount: z.int().nullable(),
    /** true bila siswa memegang NISN sebagai kunci login nasional (activeNisn terisi). */
    hasActiveNisn: z.boolean(),
    activatedAt: isoInstant.nullable(),
    createdAt: isoInstant,
    updatedAt: isoInstant,
    user: z.object({
      isActive: z.boolean(),
      mustChangePassword: z.boolean(),
      lastLoginAt: isoInstant.nullable(),
      tempPasswordExpiresAt: isoInstant.nullable(),
    }),
    activationGaps: z.array(activationGapSchema),
  })
  .meta({ id: "StudentDetail" });
export type StudentDetail = z.input<typeof studentDetailSchema>;

const temporaryPasswordFields = {
  temporaryPassword: z.string().meta({ description: "Kata sandi sementara — HANYA ditampilkan sekali." }),
  tempPasswordExpiresAt: isoInstant,
};

export const createStudentResponse = z.object({
  student: studentDetailSchema,
  ...temporaryPasswordFields,
  nisnReleased: z.boolean().meta({ description: "true bila NISN dilepas dari siswa LULUS di sekolah lain." }),
});

export const statusChangeResponse = z.object({
  student: studentDetailSchema,
  nisnReleased: z.boolean(),
  revokedSessions: z.int(),
  voidedInvoiceIds: z.array(z.string()),
});

export const resetPasswordResponse = z.object({
  ...temporaryPasswordFields,
  mustChangePassword: z.literal(true),
  revokedSessions: z.int(),
});

export const deleteStudentResponse = z.object({ id: z.string(), deleted: z.literal(true) });

export const studentProfileSchema = z
  .object({
    name: z.string(),
    nisn: z.string(),
    nis: z.string(),
    gender: genderInput,
    birthPlace: z.string().nullable(),
    birthDate: localDate.nullable(),
    className: z.string().nullable(),
    school: z.object({ name: z.string() }),
    status: studentStatus,
  })
  .meta({ id: "StudentProfile" });
export type StudentProfile = z.input<typeof studentProfileSchema>;
