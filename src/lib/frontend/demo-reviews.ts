import type { MapDto } from "@/lib/attendance/monitor-schemas";
import { instantAtLocal, localParts } from "@/lib/time/zone";

/**
 * Tinjauan anomali mode demo (B1): satu tinjauan contoh (Teguh, d20 = Valid) + keputusan yang dibuat di sesi ini.
 * Disimpan di memori halaman (immutable map, diganti utuh) dan hilang saat dimuat ulang; tidak pernah ke server.
 */
type MapPoint = MapDto["points"][number];

export interface DemoReview {
  readonly decision: "VALID" | "INVALID";
  readonly note: string | null;
  readonly reviewedAt: string;
  readonly reviewer: { readonly id: string; readonly name: string };
}

const SEEDED: Readonly<Record<string, { readonly decision: "VALID"; readonly note: string; readonly minute: number }>> = {
  "demo-att-d20": { decision: "VALID", note: "HP baru, sudah dikonfirmasi wali kelas.", minute: 8 * 60 + 5 },
};
const SEED_REVIEWER = { id: "demo:guru-bk", name: "Pak Dodi (Guru BK)" } as const;

let sessionReviews: ReadonlyMap<string, DemoReview> = new Map();

const todayWib = () => localParts(new Date(), "WIB").ymd;

export function reviewOf(attendanceId: string, date: string = todayWib()): DemoReview | null {
  const own = sessionReviews.get(attendanceId);
  if (own) return own;
  const seed = SEEDED[attendanceId];
  return seed ? { decision: seed.decision, note: seed.note, reviewedAt: instantAtLocal(date, seed.minute, "WIB").toISOString(), reviewer: SEED_REVIEWER } : null;
}

/** Titik peta setelah tinjauan: Tidak valid = ALPHA; perlu ditinjau = beranomali tanpa keputusan. */
export function withReview(point: MapPoint): MapPoint {
  const review = reviewOf(point.attendanceId);
  return {
    ...point,
    status: review?.decision === "INVALID" ? "ALPHA" : point.status,
    needsReview: point.hasAnomaly && review === null,
    reviewDecision: review?.decision ?? null,
  };
}

export function saveDemoReview(attendanceId: string, review: DemoReview): void {
  sessionReviews = new Map([...sessionReviews, [attendanceId, review]]);
}

/** Hanya untuk test: kosongkan keputusan sesi (tinjauan contoh tetap ada). */
export function resetDemoReviews(): void {
  sessionReviews = new Map();
}
