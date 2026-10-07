import { z } from "zod";
import { ICON_VARIANT_NAMES, type IconVariantName } from "./icon-rules";
import { APP_NAME_MAX, APP_NAME_MIN, normalizeAppName } from "./rules";

/** Skema identitas aplikasi (menu Pengaturan aplikasi, 2026-10-07). */
const dateTime = z.string().meta({ format: "date-time" });

export const brandingSchema = z
  .object({
    appName: z.string(),
    logoUrl: z.string().nullable().meta({ description: "URL logo unggahan (berversi). null = logo bawaan Student Hub." }),
    updatedAt: dateTime,
  })
  .meta({ id: "AppBranding" });
export type BrandingDto = z.input<typeof brandingSchema>;

export const appSettingsSchema = brandingSchema
  .extend({
    defaultAppName: z.string(),
    logoUpdatedAt: dateTime.nullable(),
  })
  .meta({ id: "AppSettings" });
export type AppSettingsDto = z.input<typeof appSettingsSchema>;

export const updateAppSettingsBody = z
  .strictObject({
    appName: z
      .string()
      .max(200)
      .transform((value, ctx) => {
        const name = normalizeAppName(value);
        if (name === null) {
          ctx.addIssue({ code: "custom", message: `Nama aplikasi ${APP_NAME_MIN}-${APP_NAME_MAX} karakter, tanpa tanda < >.` });
          return z.NEVER;
        }
        return name;
      })
      .meta({ description: `Nama aplikasi (${APP_NAME_MIN}-${APP_NAME_MAX} karakter) di sidebar, halaman masuk, splash, dan judul tab.` }),
  })
  .meta({ id: "UpdateAppSettingsInput" });
export type UpdateAppSettingsInput = z.output<typeof updateAppSettingsBody>;

export const logoUploadBody = z
  .strictObject({
    file: z.file().min(1, "Berkas logo wajib diisi.").meta({ description: "JPEG/PNG/WebP statis, sisi terpendek >= 64 px, maks 2 MB. Disimpan WebP <= 512 px (transparansi dipertahankan) tanpa EXIF." }),
  })
  .meta({ id: "UploadAppLogoInput" });
export type LogoUploadInput = z.output<typeof logoUploadBody>;

export const iconParams = z.object({
  variant: z.enum(ICON_VARIANT_NAMES as [IconVariantName, ...IconVariantName[]]).meta({ description: "favicon (96), apple (180), app-192, app-512, maskable-512, badge (96, siluet), splash (512 WebP)." }),
});

export const logoQuery = z.object({
  v: z.string().max(20).optional().meta({ description: "Versi (waktu ubah logo) untuk melewati cache; diabaikan server." }),
});
