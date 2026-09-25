import type { Prisma } from "@prisma/client";
import type { ThemeKey } from "./theme-rules";
import type { SchoolThemeDto } from "./theme-schemas";
import { resolveStoredTheme, type StoredTheme } from "./theme-store-rules";

/** Pemetaan kolom `School.theme*` <-> tema tersimpan <-> DTO SchoolTheme (dipakai /school/theme & /auth/me). */
export const SCHOOL_THEME_SELECT = {
  themePreset: true,
  themePrimaryColor: true,
  themeSecondaryColor: true,
  themeBannerColor: true,
  themeAnimationColor: true,
  themeLogoColor: true,
  themeUpdatedAt: true,
} as const satisfies Prisma.SchoolSelect;

export interface SchoolThemeRow {
  readonly themePreset: string | null;
  readonly themePrimaryColor: string | null;
  readonly themeSecondaryColor: string | null;
  readonly themeBannerColor: string | null;
  readonly themeAnimationColor: string | null;
  readonly themeLogoColor: string | null;
  readonly themeUpdatedAt: Date | null;
}

/** Kolom tema tanpa themeUpdatedAt (isi update Prisma). */
export type SchoolThemeColumns = Omit<SchoolThemeRow, "themeUpdatedAt">;

/** Bentuk audit before/after: kunci API, nilai kolom apa adanya (null = kosong). */
export type ThemeAuditValue = { readonly preset: string | null } & { readonly [K in ThemeKey]: string | null };

export const EMPTY_STORED_THEME: StoredTheme = { preset: null, colors: {} };

export function storedThemeOf(row: SchoolThemeRow): StoredTheme {
  return {
    preset: row.themePreset,
    colors: {
      primaryColor: row.themePrimaryColor,
      secondaryColor: row.themeSecondaryColor,
      bannerColor: row.themeBannerColor,
      animationColor: row.themeAnimationColor,
      logoColor: row.themeLogoColor,
    },
  };
}

export function toThemeColumns(stored: StoredTheme): SchoolThemeColumns {
  const { colors } = stored;
  return {
    themePreset: stored.preset ?? null,
    themePrimaryColor: colors.primaryColor ?? null,
    themeSecondaryColor: colors.secondaryColor ?? null,
    themeBannerColor: colors.bannerColor ?? null,
    themeAnimationColor: colors.animationColor ?? null,
    themeLogoColor: colors.logoColor ?? null,
  };
}

export function toThemeAudit(stored: StoredTheme): ThemeAuditValue {
  const { colors } = stored;
  return {
    preset: stored.preset ?? null,
    primaryColor: colors.primaryColor ?? null,
    secondaryColor: colors.secondaryColor ?? null,
    bannerColor: colors.bannerColor ?? null,
    animationColor: colors.animationColor ?? null,
    logoColor: colors.logoColor ?? null,
  };
}

/** DTO SchoolTheme: warna selalu terisi (bawaan bila kolom kosong), preset tak dikenal -> null. */
export function toSchoolThemeDto(row: SchoolThemeRow): SchoolThemeDto {
  const resolved = resolveStoredTheme(storedThemeOf(row));
  return {
    preset: resolved.preset,
    ...resolved.colors,
    isCustom: resolved.isCustom,
    updatedAt: row.themeUpdatedAt?.toISOString() ?? null,
  };
}
