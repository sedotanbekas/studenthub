import { createHash } from "node:crypto";
import { localParts } from "@/lib/time/zone";
import { MAX_ADS_PER_SLIDER, MAX_ADS_PER_SPONSOR_IN_SLIDER } from "./constants";

/**
 * Rotasi deterministik slider iklan (murni). Seed = siswa + tanggal WIB + jam WIB, sehingga urutan stabil
 * selama satu jam dan berganti tiap jam. Iklan diurutkan menurut sha256(seed:adId) — setiap iklan layak
 * mendapat peluang yang sama di slot pertama — lalu diambil berurutan dengan batas per sponsor.
 */
export interface RotationCandidate {
  readonly id: string;
  readonly sponsorId: string;
}

export interface SliderLimits {
  readonly max: number;
  readonly perSponsor: number;
}

const DEFAULT_LIMITS: SliderLimits = { max: MAX_ADS_PER_SLIDER, perSponsor: MAX_ADS_PER_SPONSOR_IN_SLIDER };

export function rotationSeed(userId: string, now: Date): string {
  const parts = localParts(now, "WIB");
  return `${userId}:${parts.ymd}:${Math.floor(parts.minuteOfDay / 60)}`;
}

const rankOf = (seed: string, adId: string): string => createHash("sha256").update(`${seed}:${adId}`).digest("hex");

export function selectAdsForSlider<T extends RotationCandidate>(candidates: readonly T[], seed: string, limits: SliderLimits = DEFAULT_LIMITS): T[] {
  const ranked = candidates
    .map((ad) => ({ ad, rank: rankOf(seed, ad.id) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  const perSponsor = new Map<string, number>();
  const picked: T[] = [];
  for (const { ad } of ranked) {
    if (picked.length >= limits.max) break;
    const used = perSponsor.get(ad.sponsorId) ?? 0;
    if (used >= limits.perSponsor) continue;
    perSponsor.set(ad.sponsorId, used + 1);
    picked.push(ad);
  }
  return picked;
}
