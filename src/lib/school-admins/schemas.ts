import { z } from "zod";
import { queryBoolean, schoolIdQuery } from "@/lib/academics/schema-common";
import { pageQuerySchema } from "@/lib/http/pagination";
import { ADMIN_MUTABLE_CATEGORIES } from "@/lib/notifications/rules";

/** Skema zod akun admin sekolah yang dikelola admin utama (/api/v1/school/admins*). */
const emailSchema = z.string().trim().toLowerCase().max(191).pipe(z.email("Format email tidak valid."));
const nameSchema = z.string().trim().min(3).max(100);
const passwordInput = z.string().min(1).max(200);

export const schoolAdminIdParams = z.object({ id: z.string().trim().min(1).max(64).meta({ description: "ID akun admin." }) });
export { schoolIdQuery };

export const listSchoolAdminsQuery = pageQuerySchema.extend({
  ...schoolIdQuery.shape,
  q: z.string().trim().min(1).max(100).optional().meta({ description: "Cari nama atau email." }),
  isActive: queryBoolean.optional(),
});
export type ListSchoolAdminsQuery = z.output<typeof listSchoolAdminsQuery>;

export const createSchoolAdminBody = z.strictObject({
  name: nameSchema.meta({ description: "Nama guru/staf, boleh disertai jabatan, mis. `Bu Rina (Wali kelas X-1)`." }),
  email: emailSchema.meta({ description: "Dipakai untuk masuk (admin tambahan selalu masuk dengan email)." }),
  initialPassword: passwordInput.optional().meta({ description: "Opsional; bila kosong sistem membuat kata sandi sementara (14 hari)." }),
});
export type CreateSchoolAdminInput = z.output<typeof createSchoolAdminBody>;

export const updateSchoolAdminBody = z
  .strictObject({ name: nameSchema.optional(), email: emailSchema.optional() })
  .refine((value) => value.name !== undefined || value.email !== undefined, { message: "Minimal satu kolom harus diubah." });
export type UpdateSchoolAdminInput = z.output<typeof updateSchoolAdminBody>;

export const deactivateSchoolAdminBody = z.strictObject({
  reason: z.string().trim().min(3).max(255).meta({ description: "Alasan penonaktifan (dicatat di riwayat aktivitas)." }),
});

export const resetSchoolAdminPasswordBody = z.strictObject({
  newPassword: passwordInput.optional().meta({ description: "Opsional; bila kosong sistem membuat kata sandi sementara (14 hari)." }),
});

const iso = z.iso.datetime();

export const schoolAdminSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    loginNpsn: z.string().nullable().meta({ description: "NPSN bila akun ini admin utama (masuk dengan NPSN)." }),
    isPrimary: z.boolean().meta({ description: "Admin utama: dikelola super admin, tidak bisa diubah lewat endpoint ini." }),
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
    tempPasswordExpiresAt: iso.nullable(),
    lastLoginAt: iso.nullable(),
    createdAt: iso,
    mutedCategories: z.array(z.enum(ADMIN_MUTABLE_CATEGORIES)).meta({ description: "Kabar sekolah yang TIDAK dikirim ke akun ini (N2); [] = terima semua." }),
  })
  .meta({ id: "SchoolAdmin" });
export type SchoolAdminDto = z.input<typeof schoolAdminSchema>;

export const createSchoolAdminResult = z.object({
  admin: schoolAdminSchema,
  temporaryPassword: z.string().optional().meta({ description: "Hanya bila dibuat sistem; ditampilkan SEKALI." }),
});
