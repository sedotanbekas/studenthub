import type { AnomalyReviewDecision, Prisma } from "@prisma/client";
import type { RuleViolation } from "@/lib/calendar/ranges";
import { diffDays, type LocalDate } from "@/lib/time/zone";
import { CORRECTION_REASON_MAX, CORRECTION_REASON_MIN, CORRECTION_WINDOW_DAYS } from "./correction-rules";

/**
 * Aturan murni tinjau anomali (B1, keputusan pemilik 2026-10-03). Dipakai server, panel admin, dan demo, jadi
 * tipe Prisma hanya `import type` dan modul ini tidak mengimpor anomaly-rules (sharp). Satu keputusan per
 * catatan: VALID = absensi tetap; INVALID = dikoreksi menjadi ALPHA. Status catatan tetap yang berwenang.
 */
export const ANOMALY_REVIEW_DECISIONS = ["VALID", "INVALID"] as const satisfies readonly AnomalyReviewDecision[];
export type ReviewDecision = (typeof ANOMALY_REVIEW_DECISIONS)[number];
export const ANOMALY_REVIEW_FILTERS = ["UNREVIEWED", "VALID", "INVALID", "ALL_ANOMALIES"] as const;
export type AnomalyReviewFilter = (typeof ANOMALY_REVIEW_FILTERS)[number];

export const REVIEW_NOTE_MIN = CORRECTION_REASON_MIN;
export const REVIEW_NOTE_MAX = CORRECTION_REASON_MAX;
/** Hari ini + 45 hari ke belakang = semua tanggal yang masih bisa Tidak valid oleh admin sekolah. */
export const UNREVIEWED_DEFAULT_RANGE_DAYS = CORRECTION_WINDOW_DAYS + 1;
export const REVIEWED_DEFAULT_RANGE_DAYS = 7;

/** Satu-satunya definisi "perlu ditinjau" di server (antrean, hitungan, rekap harian N4). */
export const PENDING_ANOMALY_REVIEW_WHERE = { hasAnomaly: true, anomalyReviewedAt: null } as const satisfies Prisma.AttendanceWhereInput;

export function needsAnomalyReview(row: { readonly hasAnomaly: boolean; readonly anomalyReviewedAt: Date | null }): boolean {
  return row.hasAnomaly && row.anomalyReviewedAt === null;
}

export function normalizeReviewNote(note: string | null | undefined): string | null {
  const text = note?.trim() ?? "";
  return text === "" ? null : text;
}

const NOTE_MESSAGES: Readonly<Record<ReviewDecision, string>> = {
  VALID: `Catatan minimal ${REVIEW_NOTE_MIN} karakter, atau kosongkan.`,
  INVALID: `Tulis alasan minimal ${REVIEW_NOTE_MIN} karakter — alasan ini dikirim ke siswa.`,
};

/** Catatan opsional untuk VALID (bila diisi min. 5); wajib min. 5 untuk INVALID (disalin ke notifikasi siswa). */
export function reviewNoteProblem(decision: ReviewDecision, note: string | null | undefined): string | null {
  const text = normalizeReviewNote(note);
  if (text !== null && text.length > REVIEW_NOTE_MAX) return `Catatan maksimal ${REVIEW_NOTE_MAX} karakter.`;
  if (text === null) return decision === "INVALID" ? NOTE_MESSAGES.INVALID : null;
  return text.length < REVIEW_NOTE_MIN ? NOTE_MESSAGES[decision] : null;
}

export type ReviewPlan = { readonly kind: "unchanged" } | { readonly kind: "mark" } | { readonly kind: "invalidate" } | { readonly kind: "violation"; readonly violation: RuleViolation };

const NO_ANOMALY: RuleViolation = { code: "NO_ANOMALY", message: "Catatan ini tidak punya anomali yang perlu ditinjau." };
const ALREADY_INVALID: RuleViolation = {
  code: "ANOMALY_ALREADY_INVALID",
  message: "Catatan ini sudah ditandai tidak valid. Untuk memulihkan status, pakai Koreksi absensi.",
};
export const FLAGS_CHANGED: RuleViolation = {
  code: "ANOMALY_FLAGS_CHANGED",
  message: "Catatan pemeriksaan berubah sejak dibuka. Periksa lagi, lalu putuskan.",
};

/** Urutan cek: tanpa anomali -> keputusan sama -> INVALID tidak bisa kembali ke VALID (pakai Koreksi). */
export function planAnomalyReview(state: { readonly hasAnomaly: boolean; readonly decision: ReviewDecision | null }, decision: ReviewDecision): ReviewPlan {
  if (!state.hasAnomaly) return { kind: "violation", violation: NO_ANOMALY };
  if (state.decision === decision) return { kind: "unchanged" };
  if (state.decision === "INVALID") return { kind: "violation", violation: ALREADY_INVALID };
  return decision === "INVALID" ? { kind: "invalidate" } : { kind: "mark" };
}

/** Status HTTP pelanggaran tinjau: konflik keadaan = 409, aturan bisnis = 422. */
export function reviewViolationStatus(code: string): 409 | 422 {
  return code === ALREADY_INVALID.code || code === FLAGS_CHANGED.code ? 409 : 422;
}

/** Flag baru pada catatan VALID membuka tinjauan lagi; INVALID tidak pernah dibuka lagi. */
export const reopensOnNewFlag = (decision: ReviewDecision | null): boolean => decision === "VALID";

export function anomalyQueueDefaultDays(filter: AnomalyReviewFilter): number {
  return filter === "UNREVIEWED" ? UNREVIEWED_DEFAULT_RANGE_DAYS : REVIEWED_DEFAULT_RANGE_DAYS;
}

/** Flag yang dilihat admin = flag tersimpan (sebagai himpunan)? Bila tidak, keputusan ditolak 409 agar diperiksa lagi. */
export function sameFlagSet(stored: readonly string[], seen: readonly string[]): boolean {
  const a = new Set(stored);
  const b = new Set(seen);
  return a.size === b.size && [...a].every((code) => b.has(code));
}

/** Tombol "Tidak valid" disembunyikan di muka bila jendela koreksi admin sekolah (45 hari) sudah lewat. */
export function invalidBlockedByWindow(check: { readonly date: LocalDate; readonly today: LocalDate; readonly windowLimited: boolean }): boolean {
  return check.windowLimited && diffDays(check.today, check.date) > CORRECTION_WINDOW_DAYS;
}
