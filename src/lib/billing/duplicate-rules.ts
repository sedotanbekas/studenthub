import { hammingDistance } from "@/lib/storage/phash";

/**
 * Penanda bukti transfer mirip (murni): dHash bukti dibandingkan dengan bukti PAYMENT_PROOF lain di sekolah
 * yang sama. Hanya MENANDAI (tidak pernah menolak) — admin memutuskan saat verifikasi.
 */
export interface HashedProof {
  readonly fileId: string;
  readonly phash: string | null;
}

export interface ProofCandidate extends HashedProof {
  /** Pengajuan yang memakai berkas ini; null = berkas belum/tidak terikat pengajuan. */
  readonly submissionId: string | null;
}

const HASH_RE = /^[0-9a-f]{16}$/i;

/** Id pengajuan lain yang buktinya berjarak Hamming <= maxDistance (urut sesuai kandidat). */
export function findNearDuplicates(target: HashedProof, candidates: readonly ProofCandidate[], maxDistance: number): string[] {
  const hash = target.phash;
  if (!hash || !HASH_RE.test(hash)) return [];
  return candidates
    .filter((c) => c.fileId !== target.fileId && c.submissionId !== null && c.phash !== null && HASH_RE.test(c.phash))
    .filter((c) => hammingDistance(hash, c.phash as string) <= maxDistance)
    .map((c) => c.submissionId as string);
}
