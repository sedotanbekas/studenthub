import { Prisma } from "@prisma/client";
import type { Tx } from "@/lib/db";
import { NEAR_DUPLICATE_MAX_DISTANCE } from "@/lib/storage/phash";
import { DUPLICATE_FLAG_LIMIT, DUPLICATE_LOOKBACK_DAYS } from "./constants";

/**
 * Penanda bukti transfer identik/mirip dalam satu sekolah (hanya MENANDAI, tidak pernah menolak).
 *
 * Dihitung SEKALI saat bukti diunggah (findUploadMatches, di database) lalu disimpan dua arah di
 * PaymentProofMatch; antrean/detail/approve/reject cukup membaca tabel itu (findPossibleDuplicates).
 * Dulu setiap pembacaan memuat hingga 5.000 hash sekolah dan membandingkannya di Node per baris.
 *
 * Tingkat sinyal (urutan tampil), maks DUPLICATE_FLAG_LIMIT per unggahan:
 *   0. sha256 identik (berkas hasil re-encode sama persis) — siswa mana pun, tanpa batas waktu (index sha256);
 *   1. dHash mirip (Hamming <= 6) milik siswa yang sama — tanpa batas waktu (index studentId);
 *   2. dHash mirip milik siswa lain — DUPLICATE_LOOKBACK_DAYS terakhir (index schoolId, kind, createdAt;
 *      berhenti setelah 5 kecocokan terbaru — tangkapan layar aplikasi bank yang sama memang mirip).
 */
const DAY_MS = 86_400_000;

export interface UploadedProof {
  readonly schoolId: string;
  readonly studentId: string;
  readonly sha256: string;
  readonly phash: string | null;
}

export interface ProofMatch {
  readonly submissionId: string;
  readonly tier: number;
}

const LIMIT = Prisma.raw(String(DUPLICATE_FLAG_LIMIT));

function nearCondition(phash: string): Prisma.Sql {
  return Prisma.sql`cf.\`phash\` IS NOT NULL
    AND BIT_COUNT(CAST(CONV(cf.\`phash\`, 16, 10) AS UNSIGNED) ^ CAST(CONV(${phash}, 16, 10) AS UNSIGNED)) <= ${NEAR_DUPLICATE_MAX_DISTANCE}`;
}

function nearBranches(proof: UploadedProof & { readonly phash: string }, lookbackFrom: Date): Prisma.Sql {
  const near = nearCondition(proof.phash);
  return Prisma.sql`
    UNION ALL
    (SELECT s.\`id\` AS submissionId, 1 AS tier, s.\`createdAt\` AS createdAt
     FROM \`PaymentSubmission\` s JOIN \`StoredFile\` cf ON cf.\`id\` = s.\`proofFileId\`
     WHERE s.\`schoolId\` = ${proof.schoolId} AND s.\`studentId\` = ${proof.studentId} AND cf.\`sha256\` <> ${proof.sha256} AND ${near}
     ORDER BY s.\`createdAt\` DESC LIMIT ${LIMIT})
    UNION ALL
    (SELECT s.\`id\`, 2, s.\`createdAt\`
     FROM \`StoredFile\` cf JOIN \`PaymentSubmission\` s ON s.\`proofFileId\` = cf.\`id\`
     WHERE cf.\`schoolId\` = ${proof.schoolId} AND cf.\`kind\` = 'PAYMENT_PROOF' AND cf.\`createdAt\` >= ${lookbackFrom}
       AND cf.\`sha256\` <> ${proof.sha256} AND s.\`studentId\` <> ${proof.studentId} AND ${near}
     ORDER BY cf.\`createdAt\` DESC LIMIT ${LIMIT})`;
}

/** Kecocokan bukti yang baru diunggah (belum tersimpan) terhadap bukti lain di sekolah yang sama. */
export async function findUploadMatches(db: Tx, proof: UploadedProof, now: Date): Promise<ProofMatch[]> {
  const lookbackFrom = new Date(now.getTime() - DUPLICATE_LOOKBACK_DAYS * DAY_MS);
  const near = proof.phash ? nearBranches({ ...proof, phash: proof.phash }, lookbackFrom) : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ submissionId: string; tier: number | bigint }>>`
    SELECT m.submissionId, m.tier FROM (
      (SELECT s.\`id\` AS submissionId, 0 AS tier, s.\`createdAt\` AS createdAt
       FROM \`StoredFile\` cf JOIN \`PaymentSubmission\` s ON s.\`proofFileId\` = cf.\`id\`
       WHERE cf.\`sha256\` = ${proof.sha256} AND cf.\`schoolId\` = ${proof.schoolId} AND cf.\`kind\` = 'PAYMENT_PROOF'
       ORDER BY cf.\`createdAt\` DESC LIMIT ${LIMIT})
      ${near}
    ) m
    ORDER BY m.tier ASC, m.createdAt DESC, m.submissionId DESC
    LIMIT ${LIMIT}`;
  return rows.map((row) => ({ submissionId: row.submissionId, tier: Number(row.tier) }));
}

/** Simpan kecocokan dua arah untuk pengajuan baru (di transaksi yang sama dengan pembuatannya). */
export async function recordProofMatches(tx: Tx, submissionId: string, matches: readonly ProofMatch[], now: Date): Promise<void> {
  const others = matches.filter((m) => m.submissionId !== submissionId);
  if (others.length === 0) return;
  await tx.paymentProofMatch.createMany({
    data: others.flatMap((m) => [
      { submissionId, matchSubmissionId: m.submissionId, tier: m.tier, createdAt: now },
      { submissionId: m.submissionId, matchSubmissionId: submissionId, tier: m.tier, createdAt: now },
    ]),
  });
}

/** targetSubmissionId -> maks DUPLICATE_FLAG_LIMIT id pengajuan penanda (tingkat terkuat, lalu terbaru). */
export async function findPossibleDuplicates(db: Tx, schoolId: string, submissionIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
  const ids = [...new Set(submissionIds)];
  if (ids.length === 0) return new Map();
  const rows = await db.$queryRaw<Array<{ targetId: string; submissionId: string }>>`
    SELECT r.targetId, r.submissionId FROM (
      SELECT pm.\`submissionId\` AS targetId, pm.\`matchSubmissionId\` AS submissionId,
             ROW_NUMBER() OVER (PARTITION BY pm.\`submissionId\` ORDER BY pm.\`tier\` ASC, s.\`createdAt\` DESC, s.\`id\` DESC) AS rn
      FROM \`PaymentProofMatch\` pm
      JOIN \`PaymentSubmission\` t ON t.\`id\` = pm.\`submissionId\` AND t.\`schoolId\` = ${schoolId}
      JOIN \`PaymentSubmission\` s ON s.\`id\` = pm.\`matchSubmissionId\` AND s.\`schoolId\` = ${schoolId}
      WHERE pm.\`submissionId\` IN (${Prisma.join(ids)})
    ) r
    WHERE r.rn <= ${DUPLICATE_FLAG_LIMIT}
    ORDER BY r.targetId, r.rn`;
  const byTarget = new Map<string, string[]>();
  for (const row of rows) byTarget.set(row.targetId, [...(byTarget.get(row.targetId) ?? []), row.submissionId]);
  return byTarget;
}
