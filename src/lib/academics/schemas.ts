import { z } from "zod";
import { SUBJECT_CODE_PATTERN, parseAcademicYearName } from "./rules";
import {
  EMPTY_PATCH_MESSAGE,
  dateOutSchema,
  entityIdSchema,
  hasAnyField,
  localDateSchema,
  queryBoolean,
  schoolIdQuery,
} from "./schema-common";

// ----------------------------------------------------------------------------- respons

export const semesterSchema = z.enum(["GANJIL", "GENAP"]);

export const termSchema = z
  .object({
    id: z.string(),
    academicYearId: z.string(),
    semester: semesterSchema,
    label: z.string().meta({ example: "Semester Ganjil 2026/2027" }),
    startDate: dateOutSchema,
    endDate: dateOutSchema,
    isActive: z.boolean(),
  })
  .meta({ id: "AcademicTerm" });

export const academicYearSummarySchema = z
  .object({ id: z.string(), name: z.string(), startDate: dateOutSchema, endDate: dateOutSchema })
  .meta({ id: "AcademicYearSummary" });

export const academicYearSchema = z
  .object({ id: z.string(), name: z.string(), startDate: dateOutSchema, endDate: dateOutSchema, terms: z.array(termSchema) })
  .meta({ id: "AcademicYear" });

export const activeTermSchema = z
  .object({ term: termSchema.nullable(), academicYear: academicYearSummarySchema.nullable() })
  .meta({ id: "AcademicActiveTerm" });

export const setActiveTermResultSchema = z
  .object({
    term: termSchema,
    academicYear: academicYearSummarySchema,
    activeStudentsOutsideYear: z.int().meta({
      description: "Peringatan: jumlah siswa AKTIF yang kelasnya kosong atau bukan kelas tahun ajaran semester ini.",
    }),
  })
  .meta({ id: "AcademicActiveTermUpdate" });

export const classSchema = z
  .object({
    id: z.string(),
    academicYearId: z.string(),
    academicYearName: z.string(),
    name: z.string(),
    gradeLevel: z.int(),
    isActive: z.boolean(),
    activeStudentCount: z.int(),
    subjectCount: z.int(),
  })
  .meta({ id: "AcademicClass" });

export const subjectSchema = z
  .object({ id: z.string(), code: z.string(), name: z.string(), kkm: z.int(), sortOrder: z.int(), isActive: z.boolean() })
  .meta({ id: "AcademicSubject" });

export const classSubjectItemSchema = z
  .object({ subjectId: z.string(), code: z.string(), name: z.string(), kkm: z.int(), sortOrder: z.int(), isActive: z.boolean() })
  .meta({ id: "AcademicClassSubject" });

export const classSubjectsSchema = z
  .object({ classId: z.string(), subjects: z.array(classSubjectItemSchema) })
  .meta({ id: "AcademicClassSubjects" });

export const setClassSubjectsResultSchema = z
  .object({
    classId: z.string(),
    subjects: z.array(classSubjectItemSchema),
    orphanGradeCount: z.int().meta({ description: "Nilai rapor DRAFT untuk mapel yang dilepas dari kelas (tetap disimpan)." }),
  })
  .meta({ id: "AcademicClassSubjectsUpdate" });

export type TermDto = z.infer<typeof termSchema>;
export type AcademicYearDto = z.infer<typeof academicYearSchema>;
export type AcademicYearSummaryDto = z.infer<typeof academicYearSummarySchema>;
export type ActiveTermDto = z.infer<typeof activeTermSchema>;
export type SetActiveTermResult = z.infer<typeof setActiveTermResultSchema>;
export type ClassDto = z.infer<typeof classSchema>;
export type SubjectDto = z.infer<typeof subjectSchema>;
export type ClassSubjectItemDto = z.infer<typeof classSubjectItemSchema>;
export type ClassSubjectsDto = z.infer<typeof classSubjectsSchema>;
export type SetClassSubjectsResult = z.infer<typeof setClassSubjectsResultSchema>;

// ----------------------------------------------------------------------------- input tahun & semester

const yearName = z
  .string()
  .trim()
  .refine((value) => parseAcademicYearName(value) !== null, "Nama tahun ajaran harus berformat YYYY/YYYY+1, mis. 2025/2026.")
  .meta({ example: "2026/2027" });

export const createAcademicYearBody = z.strictObject({ name: yearName, startDate: localDateSchema, endDate: localDateSchema });

export const updateAcademicYearBody = z
  .strictObject({ name: yearName.optional(), startDate: localDateSchema.optional(), endDate: localDateSchema.optional() })
  .refine(hasAnyField, EMPTY_PATCH_MESSAGE);

export const createTermBody = z.strictObject({ semester: semesterSchema, startDate: localDateSchema, endDate: localDateSchema });

export const updateTermBody = z
  .strictObject({ startDate: localDateSchema.optional(), endDate: localDateSchema.optional() })
  .refine(hasAnyField, EMPTY_PATCH_MESSAGE);

export const setActiveTermBody = z.strictObject({ termId: entityIdSchema });

export type CreateAcademicYearInput = z.output<typeof createAcademicYearBody>;
export type UpdateAcademicYearInput = z.output<typeof updateAcademicYearBody>;
export type CreateTermInput = z.output<typeof createTermBody>;
export type UpdateTermInput = z.output<typeof updateTermBody>;
export type SetActiveTermInput = z.output<typeof setActiveTermBody>;

// ----------------------------------------------------------------------------- input kelas & mapel

const className = z.string().trim().min(1, "Nama kelas wajib diisi.").max(50, "Nama kelas maksimal 50 karakter.");
const gradeLevel = z.int("Tingkat harus bilangan bulat.").min(1, "Tingkat minimal 1.").max(12, "Tingkat maksimal 12.");

export const listClassesQuery = schoolIdQuery.extend({
  academicYearId: entityIdSchema.optional().meta({ description: "Default: tahun ajaran semester aktif." }),
  isActive: queryBoolean.optional(),
  gradeLevel: z.coerce.number().int().min(1).max(12).optional(),
});

export const createClassBody = z.strictObject({ academicYearId: entityIdSchema, name: className, gradeLevel });

export const updateClassBody = z
  .strictObject({ name: className.optional(), gradeLevel: gradeLevel.optional(), isActive: z.boolean().optional() })
  .refine(hasAnyField, EMPTY_PATCH_MESSAGE);

export const MAX_CLASS_SUBJECTS = 60;
export const setClassSubjectsBody = z.strictObject({
  subjectIds: z
    .array(entityIdSchema)
    .max(MAX_CLASS_SUBJECTS, `Maksimal ${MAX_CLASS_SUBJECTS} mapel per kelas.`)
    .refine((ids) => new Set(ids).size === ids.length, "subjectIds tidak boleh berisi duplikat.")
    .meta({ description: "Urutan array = urutan tampil (sortOrder)." }),
});

const subjectCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(SUBJECT_CODE_PATTERN, "Kode mapel 1-20 karakter: huruf/angka di awal, lalu huruf, angka, - atau _.")
  .meta({ example: "MTK" });
const subjectName = z.string().trim().min(2, "Nama mapel minimal 2 karakter.").max(100, "Nama mapel maksimal 100 karakter.");
const kkm = z.int("KKM harus bilangan bulat.").min(0, "KKM minimal 0.").max(100, "KKM maksimal 100.");
const sortOrder = z.int("Urutan harus bilangan bulat.").min(0, "Urutan minimal 0.").max(999, "Urutan maksimal 999.");

export const listSubjectsQuery = schoolIdQuery.extend({ isActive: queryBoolean.optional() });

export const createSubjectBody = z.strictObject({ code: subjectCode, name: subjectName, kkm, sortOrder: sortOrder.optional() });

export const updateSubjectBody = z
  .strictObject({
    code: subjectCode.optional(),
    name: subjectName.optional(),
    kkm: kkm.optional(),
    sortOrder: sortOrder.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(hasAnyField, EMPTY_PATCH_MESSAGE);

export type ListClassesQuery = z.output<typeof listClassesQuery>;
export type CreateClassInput = z.output<typeof createClassBody>;
export type UpdateClassInput = z.output<typeof updateClassBody>;
export type SetClassSubjectsInput = z.output<typeof setClassSubjectsBody>;
export type ListSubjectsQuery = z.output<typeof listSubjectsQuery>;
export type CreateSubjectInput = z.output<typeof createSubjectBody>;
export type UpdateSubjectInput = z.output<typeof updateSubjectBody>;
