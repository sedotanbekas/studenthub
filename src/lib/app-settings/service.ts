import { Prisma } from "@prisma/client";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Tx } from "@/lib/db";
import { notFound } from "@/lib/http/errors";
import { log, safeErrorFields } from "@/lib/log";
import { withTx } from "@/lib/tx";
import { ICON_VARIANTS, parseGeometry, type MaskGeometry } from "./icon-rules";
import { processLogo, renderIcon, splashMaskGeometry } from "./logo-image";
import { DEFAULT_APP_NAME, logoUrlFor } from "./rules";
import type { AppSettingsDto, BrandingDto, LogoUploadInput, UpdateAppSettingsInput } from "./schemas";

/**
 * Identitas aplikasi (baris tunggal AppBranding id=1, dibuat migrasi). Dibaca SETIAP render /hub (judul tab,
 * logo, splash) -> cache singkat dalam proses; proses PM2 tunggal per lingkungan, perubahan lewat service ini
 * mengosongkan cache sehingga langsung berlaku. Byte logo hanya dibaca oleh route logo.
 */
const BRANDING_ID = 1;
const TTL_MS = 30_000;

export interface Branding {
  readonly appName: string;
  readonly logoUpdatedAt: Date | null;
  /** Geometri masker splash dari siluet logo unggahan (null = tanda bawaan). */
  readonly logoGeometry: MaskGeometry | null;
  readonly updatedAt: Date;
}

const BRANDING_SELECT = { appName: true, logoUpdatedAt: true, logoGeometry: true, updatedAt: true } as const;
type BrandingRow = Prisma.AppBrandingGetPayload<{ select: typeof BRANDING_SELECT }>;
const toBranding = (row: BrandingRow): Branding => ({ ...row, logoGeometry: row.logoUpdatedAt ? parseGeometry(row.logoGeometry) : null });
let cache: { at: number; value: Branding } | null = null;

export async function getBranding(now: number = Date.now()): Promise<Branding> {
  if (cache && now - cache.at <= TTL_MS) return cache.value;
  const value = toBranding(await prisma.appBranding.findUniqueOrThrow({ where: { id: BRANDING_ID }, select: BRANDING_SELECT }));
  cache = { at: now, value };
  return value;
}

export function invalidateBranding(): void {
  cache = null;
}

/** Untuk render halaman (layout hub, manifest): DB bermasalah tidak boleh menjatuhkan halaman -> nama bawaan. */
export async function getBrandingOrDefault(): Promise<Branding> {
  try {
    return await getBranding();
  } catch (error) {
    log.error("app_settings.branding_read_failed", safeErrorFields(error));
    return { appName: DEFAULT_APP_NAME, logoUpdatedAt: null, logoGeometry: null, updatedAt: new Date(0) };
  }
}

export const toBrandingDto = (b: Branding): BrandingDto => ({
  appName: b.appName,
  logoUrl: logoUrlFor(b.logoUpdatedAt),
  updatedAt: b.updatedAt.toISOString(),
});

const toAppSettingsDto = (b: Branding): AppSettingsDto => ({
  ...toBrandingDto(b),
  defaultAppName: DEFAULT_APP_NAME,
  logoUpdatedAt: b.logoUpdatedAt?.toISOString() ?? null,
});

export const getBrandingDto = async (): Promise<BrandingDto> => toBrandingDto(await getBranding());
export const getAppSettingsDto = async (): Promise<AppSettingsDto> => toAppSettingsDto(await getBranding());

const readInTx = async (tx: Tx): Promise<Branding> => toBranding(await tx.appBranding.findUniqueOrThrow({ where: { id: BRANDING_ID }, select: BRANDING_SELECT }));

/** Audit tanpa byte logo: cukup ada/tidaknya logo & waktunya. */
const auditView = (b: Branding) => ({ appName: b.appName, hasLogo: b.logoUpdatedAt !== null, logoUpdatedAt: b.logoUpdatedAt });

async function mutate(ctx: ActionContext, action: string, data: Prisma.AppBrandingUpdateInput): Promise<AppSettingsDto> {
  const after = await withTx(async (tx) => {
    const before = await readInTx(tx);
    await tx.appBranding.update({ where: { id: BRANDING_ID }, data: { ...data, updatedAt: ctx.now } });
    const next = await readInTx(tx);
    await writeAudit(tx, { action, entityType: "AppBranding", entityId: String(BRANDING_ID), before: auditView(before), after: auditView(next) }, ctx);
    return next;
  });
  invalidateBranding();
  return toAppSettingsDto(after);
}

/** PATCH /platform/app-settings: ganti nama aplikasi (diaudit). */
export function updateAppSettings(input: UpdateAppSettingsInput, ctx: ActionContext): Promise<AppSettingsDto> {
  return mutate(ctx, "platform.app_settings.update", { appName: input.appName });
}

/** POST /platform/app-settings/logo (multipart): logo baru menggantikan yang lama (diaudit). */
export async function uploadAppLogo(input: LogoUploadInput, ctx: ActionContext): Promise<AppSettingsDto> {
  const logo = await processLogo(new Uint8Array(await input.file.arrayBuffer()));
  // Bentuk masker animasi splash mengikuti siluet logo baru (bukan lagi tanda "S").
  const geometry = await splashMaskGeometry(await renderIcon(logo.data, ICON_VARIANTS.splash));
  return mutate(ctx, "platform.app_logo.update", {
    logo: new Uint8Array(logo.data), logoMimeType: logo.mimeType, logoUpdatedAt: ctx.now, logoGeometry: geometry ? { ...geometry } : Prisma.DbNull,
  });
}

/** DELETE /platform/app-settings/logo: kembali ke logo bawaan (diaudit). */
export function removeAppLogo(ctx: ActionContext): Promise<AppSettingsDto> {
  return mutate(ctx, "platform.app_logo.remove", { logo: null, logoMimeType: null, logoUpdatedAt: null, logoGeometry: Prisma.DbNull });
}

export interface LogoFile {
  readonly data: Uint8Array;
  readonly mimeType: string;
}

/** Byte logo untuk route publik; belum ada logo unggahan -> 404 LOGO_NOT_FOUND (klien memakai logo bawaan). */
export async function readLogo(): Promise<LogoFile> {
  const row = await prisma.appBranding.findUnique({ where: { id: BRANDING_ID }, select: { logo: true, logoMimeType: true } });
  if (!row?.logo || !row.logoMimeType) throw notFound("Logo aplikasi belum diunggah.", "LOGO_NOT_FOUND");
  return { data: row.logo, mimeType: row.logoMimeType };
}
