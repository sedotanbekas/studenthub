import type { AdLinkType, AdTargetScope, SponsorStatus } from "@prisma/client";
import type { Db, Tx } from "@/lib/db";
import { forbidden } from "@/lib/http/errors";
import { normalizeTargets, scheduleViolation, targetKeysOf, type TargetInput, type TargetRow } from "./ad-rules";
import { adViolation, assertAdRule, failAd } from "./errors";
import { validateAdLink } from "./link-rules";

/**
 * Validasi konten iklan sebelum ditulis: tautan (skema aman / allowlist), jadwal, dan target (format murni lalu
 * keberadaan kode wilayah & sekolah aktif di DB). Dipakai create & update.
 */
export interface AdContent {
  readonly title: string;
  readonly imageFileId: string;
  readonly linkType: AdLinkType;
  readonly targetUrl: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly targetScope: AdTargetScope;
  readonly rows: readonly TargetRow[];
}

export interface ContentInput {
  readonly title: string;
  readonly imageFileId: string;
  readonly linkType: AdLinkType;
  readonly targetUrl: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly targetScope: AdTargetScope;
  readonly targets: TargetInput;
}

export function checkLink(targetUrl: string, linkType: AdLinkType, allowedSchemes: readonly string[]): string {
  const link = validateAdLink(targetUrl, linkType, allowedSchemes);
  if (!link.ok) {
    const hint = linkType === "EXTERNAL_URL" ? "Tautan harus https:// ke domain publik." : "Skema aplikasi tidak ada di daftar yang diizinkan.";
    failAd(adViolation("AD_LINK_INVALID", `Tautan iklan tidak valid. ${hint}`, { reason: link.reason }));
  }
  return link.href;
}

/** Semua kode provinsi/kab-kota ada & semua sekolah target aktif. */
export async function assertTargetsExist(db: Db | Tx, rows: readonly TargetRow[]): Promise<void> {
  const pick = (key: "provinceCode" | "cityCode" | "schoolId"): string[] =>
    rows.flatMap((r) => (key in r ? [(r as Record<string, string>)[key] ?? ""] : []));
  const [provinces, cities, schools] = [pick("provinceCode"), pick("cityCode"), pick("schoolId")];
  const [p, c, s] = await Promise.all([
    provinces.length ? db.province.count({ where: { code: { in: provinces } } }) : 0,
    cities.length ? db.city.count({ where: { code: { in: cities } } }) : 0,
    schools.length ? db.school.count({ where: { id: { in: schools }, isActive: true } }) : 0,
  ]);
  if (p !== provinces.length || c !== cities.length || s !== schools.length) {
    failAd(adViolation("AD_TARGETS_INVALID", "Sebagian target tidak dikenal atau sekolahnya tidak aktif."));
  }
}

export async function prepareContent(db: Db | Tx, input: ContentInput, linkHref: string, now: Date): Promise<AdContent> {
  assertAdRule(scheduleViolation({ startAt: input.startAt, endAt: input.endAt }, now, "draft"));
  const targets = normalizeTargets(input.targetScope, input.targets);
  if (!targets.ok) failAd(targets.violation);
  await assertTargetsExist(db, targets.rows);
  const { title, imageFileId, linkType, startAt, endAt, targetScope } = input;
  return { title, imageFileId, linkType, targetUrl: linkHref, startAt, endAt, targetScope, rows: targets.rows };
}

/** Kunci pembanding review ulang untuk baris target hasil normalisasi. */
export const rowKeys = (rows: readonly TargetRow[]): string[] =>
  targetKeysOf(rows.map((r) => ({
    provinceCode: "provinceCode" in r ? r.provinceCode : null,
    cityCode: "cityCode" in r ? r.cityCode : null,
    schoolId: "schoolId" in r ? r.schoolId : null,
  })));

/** Sponsor ditangguhkan hanya-baca (diulang di bawah kunci; POLICY sudah menyaring di awal request). */
export function assertSponsorWritable(status: SponsorStatus): void {
  if (status === "SUSPENDED") throw forbidden("SPONSOR_SUSPENDED", "Akun sponsor ditangguhkan.");
}

export function assertSponsorApproved(status: SponsorStatus): void {
  assertSponsorWritable(status);
  if (status !== "APPROVED") throw forbidden("SPONSOR_NOT_APPROVED", "Akun sponsor belum disetujui.");
}
