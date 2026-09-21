import type { StudentStatusValue } from "./constants";

export type NisnClaimDecision = "CLAIM" | "RELEASE_AND_CLAIM" | "CONFLICT";

export interface NisnHolder {
  readonly id: string;
  readonly status: StudentStatusValue;
}

/**
 * Keputusan klaim activeNisn (murni). Pemegang LULUS di sekolah lain dilepas; pemegang AKTIF/NONAKTIF
 * menolak klaim (sekolah asal harus menandai Pindah/Lulus). `selfId` null = siswa belum dibuat.
 */
export function decideNisnClaim(holder: NisnHolder | null, selfId: string | null): NisnClaimDecision {
  if (holder === null || holder.id === selfId) return "CLAIM";
  if (holder.status === "GRADUATED") return "RELEASE_AND_CLAIM";
  return "CONFLICT";
}
