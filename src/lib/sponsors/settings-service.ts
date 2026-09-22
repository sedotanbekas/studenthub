import type { Prisma } from "@prisma/client";
import { isForbiddenScheme, SCHEME_PATTERN } from "@/lib/ads/link-rules";
import { writeAudit } from "@/lib/audit";
import type { ActionContext } from "@/lib/auth/principal";
import { prisma, type Db, type Tx } from "@/lib/db";
import { withTx } from "@/lib/tx";
import { LOW_BALANCE_THRESHOLD } from "./constants";
import { failSponsor, sponsorViolation } from "./errors";
import type { AdSettingsDto } from "./response-schemas";
import type { UpdateAdSettingsInput } from "./schemas";

/**
 * Pengaturan platform iklan (baris tunggal PlatformSetting id=1, dibuat migrasi init). Dibaca tanpa cache
 * (satu baris ber-PK) agar perubahan super admin langsung berlaku di semua jalur.
 */
export const SETTINGS_ID = 1;

export interface AdSettings {
  readonly defaultCpcAmount: number;
  readonly minTopUpAmount: number;
  readonly topUpBankName: string | null;
  readonly topUpAccountNumber: string | null;
  readonly topUpAccountHolder: string | null;
  readonly deepLinkSchemes: readonly string[];
  readonly updatedAt: Date;
}

/** Json tersimpan -> daftar skema (nilai rusak diabaikan, bukan dipercaya). */
export function parseSchemes(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && SCHEME_PATTERN.test(item) && !isForbiddenScheme(item));
}

export async function getAdSettings(db: Db | Tx = prisma): Promise<AdSettings> {
  const row = await db.platformSetting.findUniqueOrThrow({ where: { id: SETTINGS_ID } });
  return { ...row, deepLinkSchemes: parseSchemes(row.deepLinkSchemes) };
}

export const toAdSettingsDto = (s: AdSettings): AdSettingsDto => ({
  defaultCpcAmount: s.defaultCpcAmount,
  minTopUpAmount: s.minTopUpAmount,
  topUpBankName: s.topUpBankName,
  topUpAccountNumber: s.topUpAccountNumber,
  topUpAccountHolder: s.topUpAccountHolder,
  deepLinkSchemes: [...s.deepLinkSchemes],
  lowBalanceThreshold: LOW_BALANCE_THRESHOLD,
  updatedAt: s.updatedAt.toISOString(),
});

export const getAdSettingsDto = async (): Promise<AdSettingsDto> => toAdSettingsDto(await getAdSettings());

/** Skema allowlist: format RFC 3986, bukan skema berbahaya/web, tanpa duplikat. */
export function normalizeSchemes(schemes: readonly string[]): string[] {
  const unique = [...new Set(schemes.map((s) => s.trim().toLowerCase()))];
  const bad = unique.filter((s) => !SCHEME_PATTERN.test(s) || isForbiddenScheme(s));
  if (bad.length > 0) {
    failSponsor(sponsorViolation("SETTINGS_INVALID", "Skema deep link tidak diizinkan (format tidak valid atau skema berbahaya).", { schemes: bad }));
  }
  return unique;
}

function settingsPatch(input: UpdateAdSettingsInput): Prisma.PlatformSettingUpdateInput {
  return {
    ...(input.defaultCpcAmount !== undefined ? { defaultCpcAmount: input.defaultCpcAmount } : {}),
    ...(input.minTopUpAmount !== undefined ? { minTopUpAmount: input.minTopUpAmount } : {}),
    ...(input.topUpBankName !== undefined ? { topUpBankName: input.topUpBankName } : {}),
    ...(input.topUpAccountNumber !== undefined ? { topUpAccountNumber: input.topUpAccountNumber } : {}),
    ...(input.topUpAccountHolder !== undefined ? { topUpAccountHolder: input.topUpAccountHolder } : {}),
    ...(input.deepLinkSchemes !== undefined ? { deepLinkSchemes: normalizeSchemes(input.deepLinkSchemes) } : {}),
  };
}

/** PATCH pengaturan: diaudit (before/after). CPC baru tidak mengubah iklan yang sudah diajukan. */
export async function updateAdSettings(input: UpdateAdSettingsInput, ctx: ActionContext): Promise<AdSettingsDto> {
  const data = settingsPatch(input);
  const updated = await withTx(async (tx) => {
    const before = await getAdSettings(tx);
    await tx.platformSetting.update({ where: { id: SETTINGS_ID }, data: { ...data, updatedAt: ctx.now } });
    const after = await getAdSettings(tx);
    await writeAudit(tx, { action: "platform.ads_settings.update", entityType: "PlatformSetting", entityId: String(SETTINGS_ID), before, after }, ctx);
    return after;
  });
  return toAdSettingsDto(updated);
}
