import { z } from "zod";
import { pageQuerySchema } from "@/lib/http/pagination";

/** Skema zod pengelolaan akun oleh SUPER_ADMIN (/api/v1/platform/users*). */
export const USER_ROLES = ["SUPER_ADMIN", "SCHOOL_ADMIN", "SPONSOR", "STUDENT"] as const;
export const userRoleSchema = z.enum(USER_ROLES);

const idString = z.string().trim().min(1).max(64);
/** Email dinormalisasi (trim + huruf kecil); keunikan tanpa peka huruf dijaga kolasi _ci. */
const emailSchema = z.string().trim().toLowerCase().max(191).pipe(z.email("Format email tidak valid."));
const nameSchema = z.string().trim().min(3).max(100);
const passwordInput = z.string().min(1).max(200);
const booleanQuery = z.enum(["true", "false"]).transform((value) => value === "true");

export const userIdParams = z.object({ id: idString.meta({ description: "ID pengguna." }) });

export const listUsersQuery = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional().meta({ description: "Cari nama atau email." }),
  role: userRoleSchema.optional(),
  schoolId: idString.optional(),
  sponsorId: idString.optional(),
  isActive: booleanQuery.optional(),
});
export type ListUsersQuery = z.output<typeof listUsersQuery>;

export const createUserBody = z.strictObject({
  role: userRoleSchema.meta({ description: "Hanya SCHOOL_ADMIN atau SUPER_ADMIN; SPONSOR/STUDENT -> 400 USE_DEDICATED_ENDPOINT." }),
  name: nameSchema,
  email: emailSchema,
  schoolId: idString.optional().meta({ description: "Wajib untuk SCHOOL_ADMIN (sekolah harus aktif); dilarang untuk SUPER_ADMIN." }),
  initialPassword: passwordInput.optional().meta({ description: "Opsional; bila kosong sistem membuat kata sandi sementara (14 hari)." }),
});
export type CreateUserInput = z.output<typeof createUserBody>;

export const updateUserBody = z
  .strictObject({ name: nameSchema.optional(), email: emailSchema.optional() })
  .refine((value) => value.name !== undefined || value.email !== undefined, { message: "Minimal satu kolom harus diubah." });
export type UpdateUserInput = z.output<typeof updateUserBody>;

export const deactivateUserBody = z.strictObject({
  reason: z.string().trim().min(3).max(255).meta({ description: "Alasan penonaktifan (dicatat di audit)." }),
});

export const resetPasswordBody = z.strictObject({
  newPassword: passwordInput.optional().meta({ description: "Opsional; bila kosong sistem membuat kata sandi sementara (14 hari)." }),
});

// ----------------------------------------------------------------------------- respons

const iso = z.iso.datetime();

export const platformUserSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string().nullable(),
    role: userRoleSchema,
    isActive: z.boolean(),
    mustChangePassword: z.boolean(),
    tempPasswordExpiresAt: iso.nullable(),
    school: z.object({ id: z.string(), name: z.string() }).nullable(),
    sponsor: z.object({ id: z.string(), companyName: z.string() }).nullable(),
    lastLoginAt: iso.nullable(),
    passwordChangedAt: iso.nullable(),
    createdAt: iso,
    updatedAt: iso,
  })
  .meta({ id: "PlatformUser" });

export const platformUserDetailSchema = platformUserSchema
  .extend({ activeSessionCount: z.int().meta({ description: "Sesi yang belum dicabut dan belum kedaluwarsa." }) })
  .meta({ id: "PlatformUserDetail" });

export const createUserResult = z.object({
  user: platformUserSchema,
  temporaryPassword: z.string().optional().meta({ description: "Hanya bila dibuat sistem; ditampilkan SEKALI." }),
});

export const deactivateUserResult = z.object({ id: z.string(), isActive: z.boolean(), revokedSessions: z.int() });
export const activateUserResult = z.object({ id: z.string(), isActive: z.boolean() });
export const revokeSessionsResult = z.object({ revokedCount: z.int() });
export const resetPasswordResult = z.object({
  mustChangePassword: z.literal(true),
  temporaryPassword: z.string().optional().meta({ description: "Hanya bila dibuat sistem; ditampilkan SEKALI." }),
});

export type PlatformUserDto = z.input<typeof platformUserSchema>;
export type PlatformUserDetailDto = z.input<typeof platformUserDetailSchema>;
