import { z } from "zod";
import { HEX_COLOR_PATTERN } from "./theme-rules";
import { THEME_PRESET_KEYS } from "./theme-store-rules";

/**
 * Skema zod tema sekolah. Modul kecil terpisah agar auth-schemas (/auth/me) bisa memakai SchoolTheme
 * tanpa menarik seluruh skema domain sekolah. Tidak ada aturan kontras: sekolah bebas memilih warna
 * merek, web menurunkan warna teks yang terbaca lewat themeVariables().
 */
const HEX_INPUT_PATTERN = /^#[0-9a-fA-F]{6}$/;

const hexColor = (description: string) =>
  z
    .string()
    .trim()
    .regex(HEX_INPUT_PATTERN, "Warna harus berformat #RRGGBB (6 digit heksadesimal).")
    .transform((value) => value.toLowerCase())
    .meta({ description: `${description} Disimpan sebagai #rrggbb huruf kecil.`, example: "#1d4ed8" });

const presetKey = z.enum(THEME_PRESET_KEYS);

/** PUT = ganti utuh: kelima warna wajib; preset opsional (label asal palet, null/kosong = kustom). */
export const updateSchoolThemeBody = z
  .strictObject({
    preset: presetKey.nullable().optional().meta({ description: "Preset asal palet (hanya label). Kosong/null = palet kustom." }),
    primaryColor: hexColor("Warna primer: tombol, tautan, penanda aktif."),
    secondaryColor: hexColor("Warna sekunder: aksen pendamping, chip, badge."),
    bannerColor: hexColor("Warna banner: kartu identitas & header beranda."),
    animationColor: hexColor("Warna animasi: loader, transisi, sorotan gerak."),
    logoColor: hexColor("Warna logo: latar lambang sekolah/aplikasi."),
  })
  .meta({ id: "UpdateSchoolThemeInput" });
export type UpdateSchoolThemeInput = z.output<typeof updateSchoolThemeBody>;

const resolvedColor = (description: string) => z.string().regex(HEX_COLOR_PATTERN).meta({ description, example: "#1d4ed8" });

export const schoolThemeSchema = z
  .object({
    preset: presetKey.nullable().meta({ description: "`nusantara` bila tema bawaan; null = palet kustom tanpa preset." }),
    primaryColor: resolvedColor("#rrggbb; selalu terisi (bawaan bila belum diatur)."),
    secondaryColor: resolvedColor("#rrggbb."),
    bannerColor: resolvedColor("#rrggbb."),
    animationColor: resolvedColor("#rrggbb."),
    logoColor: resolvedColor("#rrggbb."),
    isCustom: z.boolean().meta({ description: "false = sekolah memakai tema bawaan aplikasi." }),
    updatedAt: z.iso.datetime().nullable().meta({ description: "Terakhir diubah/di-reset; null = belum pernah." }),
  })
  .meta({ id: "SchoolTheme" });
export type SchoolThemeDto = z.input<typeof schoolThemeSchema>;
