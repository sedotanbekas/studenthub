import type { AdLinkType, AdStatus, AdTargetScope, SponsorStatus } from "@prisma/client";
import { AD_MAX_DURATION_DAYS, AD_MAX_START_LEAD_DAYS, AD_MIN_DURATION_MS, MAX_TARGETS_PER_AD, type AD_DISPLAY_STATUSES } from "./constants";
import { adViolation, type AdViolation } from "./errors";

/** Aturan murni siklus iklan: jadwal, target, transisi, review ulang, status tampilan (tanpa Prisma). */

const DAY_MS = 86_400_000;

// ----------------------------------------------------------------------------- jadwal

export interface Schedule {
  readonly startAt: Date;
  readonly endAt: Date;
}

/** "draft" = simpan/ubah; "submit" = ajukan/lanjutkan (akhir jadwal wajib di masa depan). */
export function scheduleViolation(s: Schedule, now: Date, mode: "draft" | "submit"): AdViolation | null {
  const duration = s.endAt.getTime() - s.startAt.getTime();
  if (duration < AD_MIN_DURATION_MS) return adViolation("AD_SCHEDULE_INVALID", "Durasi tayang minimal 1 jam (akhir harus setelah mulai).");
  if (duration > AD_MAX_DURATION_DAYS * DAY_MS) return adViolation("AD_SCHEDULE_INVALID", `Durasi tayang maksimal ${AD_MAX_DURATION_DAYS} hari.`);
  if (s.startAt.getTime() > now.getTime() + AD_MAX_START_LEAD_DAYS * DAY_MS) {
    return adViolation("AD_SCHEDULE_INVALID", `Tanggal mulai maksimal ${AD_MAX_START_LEAD_DAYS} hari ke depan.`);
  }
  if (mode === "submit" && s.endAt.getTime() <= now.getTime()) {
    return adViolation("AD_SCHEDULE_INVALID", "Jadwal tayang sudah berakhir; perpanjang tanggal akhir terlebih dahulu.");
  }
  return null;
}

// ----------------------------------------------------------------------------- target

export interface TargetInput {
  readonly provinceCodes?: readonly string[] | undefined;
  readonly cityCodes?: readonly string[] | undefined;
  readonly schoolIds?: readonly string[] | undefined;
}

export type TargetRow = { readonly provinceCode: string } | { readonly cityCode: string } | { readonly schoolId: string };
export type TargetResult = { readonly ok: true; readonly rows: readonly TargetRow[] } | { readonly ok: false; readonly violation: AdViolation };

type ListKey = keyof TargetInput;
const LIST_BY_SCOPE: Readonly<Record<Exclude<AdTargetScope, "ALL">, { key: ListKey; pattern: RegExp; column: string }>> = {
  PROVINCE: { key: "provinceCodes", pattern: /^\d{2}$/, column: "provinceCode" },
  CITY: { key: "cityCodes", pattern: /^\d{2}\.\d{2}$/, column: "cityCode" },
  SCHOOL: { key: "schoolIds", pattern: /^[A-Za-z0-9_-]{1,64}$/, column: "schoolId" },
};
const LIST_KEYS: readonly ListKey[] = ["provinceCodes", "cityCodes", "schoolIds"];

const invalidTargets = (message: string): TargetResult => ({ ok: false, violation: adViolation("AD_TARGETS_INVALID", message) });
const filled = (input: TargetInput, key: ListKey): boolean => (input[key]?.length ?? 0) > 0;

/** Tepat satu daftar yang cocok dengan cakupan (ALL = tanpa daftar); dedupe + urut agar deterministik. */
export function normalizeTargets(scope: AdTargetScope, input: TargetInput): TargetResult {
  if (scope === "ALL") {
    return LIST_KEYS.some((key) => filled(input, key)) ? invalidTargets("Cakupan semua sekolah tidak memakai daftar target.") : { ok: true, rows: [] };
  }
  const spec = LIST_BY_SCOPE[scope];
  if (LIST_KEYS.some((key) => key !== spec.key && filled(input, key))) return invalidTargets("Daftar target tidak sesuai cakupan.");
  const unique = [...new Set(input[spec.key] ?? [])].sort();
  if (unique.length === 0) return invalidTargets("Pilih minimal satu target.");
  if (unique.length > MAX_TARGETS_PER_AD) return invalidTargets(`Maksimal ${MAX_TARGETS_PER_AD} target per iklan.`);
  if (unique.some((value) => !spec.pattern.test(value))) return invalidTargets("Format kode target tidak valid.");
  return { ok: true, rows: unique.map((value) => ({ [spec.column]: value }) as TargetRow) };
}

export interface StoredTarget {
  readonly provinceCode: string | null;
  readonly cityCode: string | null;
  readonly schoolId: string | null;
}

export interface SchoolLocation {
  readonly id: string;
  readonly provinceCode: string;
  readonly cityCode: string;
}

export function matchesTarget(scope: AdTargetScope, targets: readonly StoredTarget[], school: SchoolLocation): boolean {
  switch (scope) {
    case "ALL":
      return true;
    case "PROVINCE":
      return targets.some((t) => t.provinceCode === school.provinceCode);
    case "CITY":
      return targets.some((t) => t.cityCode === school.cityCode);
    case "SCHOOL":
      return targets.some((t) => t.schoolId === school.id);
  }
}

/** Kunci target berawalan kolom, terurut (perbandingan himpunan tanpa peduli urutan). */
export function targetKeysOf(targets: readonly StoredTarget[]): string[] {
  return targets
    .map((t) => (t.provinceCode ? `p:${t.provinceCode}` : t.cityCode ? `c:${t.cityCode}` : `s:${t.schoolId ?? ""}`))
    .sort();
}

// ----------------------------------------------------------------------------- transisi

export type AdAction = "submit" | "withdraw" | "pause" | "resume" | "archive" | "approve" | "reject" | "takedown";

const AD_TRANSITIONS: Readonly<Record<AdAction, Partial<Record<AdStatus, AdStatus>>>> = {
  submit: { DRAFT: "PENDING_REVIEW", REJECTED: "PENDING_REVIEW" },
  withdraw: { PENDING_REVIEW: "DRAFT" },
  pause: { APPROVED: "PAUSED" },
  resume: { PAUSED: "APPROVED" },
  archive: { DRAFT: "ARCHIVED", REJECTED: "ARCHIVED", APPROVED: "ARCHIVED", PAUSED: "ARCHIVED" },
  approve: { PENDING_REVIEW: "APPROVED" },
  reject: { PENDING_REVIEW: "REJECTED" },
  takedown: { APPROVED: "REJECTED", PAUSED: "REJECTED", PENDING_REVIEW: "REJECTED" },
};

/** Status berikutnya, atau null bila transisi tidak sah (-> 409 AD_INVALID_TRANSITION). */
export function nextAdStatus(current: AdStatus, action: AdAction): AdStatus | null {
  return AD_TRANSITIONS[action][current] ?? null;
}

/** Status sumber yang sah untuk aksi (dipakai CAS updateMany). */
export const sourceStatusesOf = (action: AdAction): AdStatus[] => Object.keys(AD_TRANSITIONS[action]) as AdStatus[];

export type EditOutcome = "SAME" | "REREVIEW" | "LOCKED_PENDING" | "LOCKED";

/** Ubah konten iklan aktif (APPROVED/PAUSED) -> PENDING_REVIEW; judul/jadwal saja tidak. */
export function editOutcome(current: AdStatus, reReview: boolean): EditOutcome {
  if (current === "PENDING_REVIEW") return "LOCKED_PENDING";
  if (current === "ARCHIVED") return "LOCKED";
  if ((current === "APPROVED" || current === "PAUSED") && reReview) return "REREVIEW";
  return "SAME";
}

export interface ReviewedContent {
  readonly imageFileId: string;
  readonly targetUrl: string;
  readonly linkType: AdLinkType;
  readonly targetScope: AdTargetScope;
  readonly targetKeys: readonly string[];
}

export function requiresReReview(before: ReviewedContent, after: ReviewedContent): boolean {
  if (before.imageFileId !== after.imageFileId || before.targetUrl !== after.targetUrl) return true;
  if (before.linkType !== after.linkType || before.targetScope !== after.targetScope) return true;
  const a = [...before.targetKeys].sort();
  const b = [...after.targetKeys].sort();
  return a.length !== b.length || a.some((key, i) => key !== b[i]);
}

// ----------------------------------------------------------------------------- status tampilan

export type AdDisplayStatus = (typeof AD_DISPLAY_STATUSES)[number];

export interface AdState {
  readonly status: AdStatus;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly cpcAmount: number;
}

export interface SponsorState {
  readonly status: SponsorStatus;
  readonly balance: number;
}

const STORED_DISPLAY: ReadonlySet<AdStatus> = new Set<AdStatus>(["ARCHIVED", "DRAFT", "PENDING_REVIEW", "REJECTED"]);

/** Urutan: status tersimpan non-tayang -> ENDED -> PAUSED -> sponsor -> SCHEDULED -> saldo -> LIVE. */
export function deriveDisplayStatus(ad: AdState, sponsor: SponsorState, now: Date): AdDisplayStatus {
  if (STORED_DISPLAY.has(ad.status)) return ad.status as AdDisplayStatus;
  if (ad.endAt.getTime() <= now.getTime()) return "ENDED";
  if (ad.status === "PAUSED") return "PAUSED";
  if (sponsor.status !== "APPROVED") return "SPONSOR_INACTIVE";
  if (ad.startAt.getTime() > now.getTime()) return "SCHEDULED";
  return sponsor.balance >= ad.cpcAmount ? "LIVE" : "NO_BALANCE";
}

/** Iklan sedang berjalan (tanpa menilai saldo; saldo dinilai terpisah saat klik). */
export function isAdRunning(ad: Omit<AdState, "cpcAmount">, sponsorStatus: SponsorStatus, now: Date): boolean {
  const t = now.getTime();
  return ad.status === "APPROVED" && sponsorStatus === "APPROVED" && ad.startAt.getTime() <= t && t < ad.endAt.getTime();
}
